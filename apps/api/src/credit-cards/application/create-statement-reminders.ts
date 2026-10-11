import { addDays, instantToZonedLocal } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import {
  STATEMENT_REMINDER_TIME,
  owesStatement,
  reminderCandidates,
  reminderKey,
} from '../domain/statement-reminder';
import type { CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';
import type {
  StatementReminderInput,
  StatementReminderPublisher,
} from './ports/statement-reminder-publisher';
import type {
  StatementReminderEntry,
  StatementReminderSource,
} from './ports/statement-reminder-source';
import { buildStatementViews } from './statement-views';

const DEFAULT_PAGE_SIZE = 500;

/** A failure, with identifiers only: no name, amount, language or message (spec D16). */
export interface ReminderFailure {
  cardId: string;
  errorName: string;
}

export interface ReminderSummary {
  cards: number;
  reminders: number;
  notOwed: number;
  alreadyPublished: number;
  failed: number;
}

export interface CreateStatementRemindersDeps extends Pick<
  CreditCardDependencies,
  'cards' | 'purchases' | 'installments' | 'cardPayments' | 'clock'
> {
  source: StatementReminderSource;
  publisher: StatementReminderPublisher;
  /** Issues the write scope of a card owner; the caller (the job factory) owns that policy. */
  scopeFor: (ownerId: string) => Promise<AccessScope<'write'>>;
  report: (failure: ReminderFailure) => void;
  pageSize?: number;
}

export class CreateStatementReminders {
  constructor(private readonly deps: CreateStatementRemindersDeps) {}

  /**
   * One pass: for every card, creates the notice of each statement whose reminder day has come
   * (09:00 local, `reminderDays` before the due date), that is not past due and still owes
   * something. A notice that exists is never created twice, and a failure of one card never stops
   * the others; what failed is retried by the next pass.
   */
  async execute(): Promise<ReminderSummary> {
    const summary: ReminderSummary = {
      cards: 0,
      reminders: 0,
      notOwed: 0,
      alreadyPublished: 0,
      failed: 0,
    };
    const limit = this.deps.pageSize ?? DEFAULT_PAGE_SIZE;
    let afterId: string | null = null;
    for (;;) {
      const page: StatementReminderEntry[] = await this.deps.source.page(afterId, limit);
      for (const entry of page) {
        summary.cards++;
        await this.processCard(entry, summary);
      }
      const last = page[page.length - 1];
      if (page.length < limit || !last) return summary;
      afterId = last.card.id;
    }
  }

  private async processCard(
    entry: StatementReminderEntry,
    summary: ReminderSummary,
  ): Promise<void> {
    const { ownerId, timeZone, language, card } = entry;
    try {
      // An unknown zone name falls back to the stored default inside the shared time helpers.
      const local = instantToZonedLocal(this.deps.clock.now(), timeZone);
      const today = local.slice(0, 10);
      const reminderToday = local.slice(11) >= STATEMENT_REMINDER_TIME ? today : addDays(today, -1);
      const scope = await this.deps.scopeFor(ownerId);
      const statements = await ensureStatements(this.deps.cards, scope, card, today);
      const candidates = reminderCandidates({
        statements,
        reminderDays: card.reminderDays,
        today,
        reminderToday,
      });
      if (candidates.length === 0) return;
      const existing = await this.deps.publisher.published(
        ownerId,
        candidates.map(({ id, dueDate }) => ({ statementId: id, dueDate })),
      );
      const pending = candidates.filter(
        (statement) => !existing.has(reminderKey(statement.id, statement.dueDate)),
      );
      summary.alreadyPublished += candidates.length - pending.length;
      if (pending.length === 0) return;
      const views = await buildStatementViews(this.deps, scope, card, statements, timeZone, today);
      const inputs: StatementReminderInput[] = [];
      for (const statement of pending) {
        const view = views.find((candidate) => candidate.id === statement.id);
        if (!view || !owesStatement(view)) {
          summary.notOwed++;
          continue;
        }
        inputs.push({
          ownerId,
          statementId: statement.id,
          cardName: card.name,
          dueDate: statement.dueDate,
          language,
        });
      }
      if (inputs.length === 0) return;
      summary.reminders += await this.deps.publisher.publishMany(inputs);
    } catch (error) {
      summary.failed++;
      this.deps.report({ cardId: card.id, errorName: nameOf(error) });
    }
  }
}

const nameOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
