import { AppError, addDays, instantToZonedLocal, zonedLocalToInstant } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import {
  AUTOMATIC_DEBIT_DUE_TIME,
  automaticDebitMovementId,
  debitCandidates,
  unpaidRemainder,
  type DebitCandidate,
} from '../domain/automatic-debit';
import type { CreditCard } from '../domain/credit-card';
import type { Currency } from '../domain/statement-payment';
import type { CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';
import type {
  AutomaticDebitLog,
  AutomaticDebitSettlement,
  AutomaticDebitSkipReason,
} from './ports/automatic-debit-log';
import type { AutomaticDebitRecorder } from './ports/automatic-debit-recorder';
import type { AutomaticDebitEntry, AutomaticDebitSource } from './ports/automatic-debit-source';
import { buildStatementViews } from './statement-views';

const DEFAULT_PAGE_SIZE = 500;

/** A failure, with identifiers only: no amount, name or message (spec D11). */
export interface DebitFailure {
  cardId: string;
  /** `null` when the failure hit the card before any statement was reached. */
  period: string | null;
  currency: Currency | null;
  errorName: string;
}

/** A settled debit worth an info line; identifiers and the skip reason only. */
export interface DebitInfo {
  event: 'recorded' | 'skipped';
  cardId: string;
  period: string;
  currency: Currency;
  reason?: AutomaticDebitSkipReason;
}

export interface DebitSummary {
  cards: number;
  recorded: number;
  skippedCovered: number;
  skippedUnavailable: number;
  skippedRefused: number;
  alreadySettled: number;
  failed: number;
}

export interface RecordAutomaticDebitsDeps extends Pick<
  CreditCardDependencies,
  'cards' | 'purchases' | 'installments' | 'cardPayments' | 'clock'
> {
  source: AutomaticDebitSource;
  log: AutomaticDebitLog;
  recorder: AutomaticDebitRecorder;
  /** Issues the write scope of a card owner; the caller (the job factory) owns that policy. */
  scopeFor: (ownerId: string) => Promise<AccessScope<'write'>>;
  report: (failure: DebitFailure) => void;
  info: (info: DebitInfo) => void;
  pageSize?: number;
}

export class RecordAutomaticDebits {
  constructor(private readonly deps: RecordAutomaticDebitsDeps) {}

  /**
   * One pass: for every card with a debit account, records the transfer of the unpaid remainder of
   * each statement that is due (06:00 local of its due date, no upper bound) and not settled yet.
   * The transfer id comes from the (card, period, currency) key and the claim is taken under a
   * lock, so a repeated, concurrent or interrupted pass records at most one transfer (NFR-03).
   * A failure never stops the other statements or cards; a plain `Error` leaves the key unclaimed
   * for the next pass.
   */
  async execute(): Promise<DebitSummary> {
    const summary: DebitSummary = {
      cards: 0,
      recorded: 0,
      skippedCovered: 0,
      skippedUnavailable: 0,
      skippedRefused: 0,
      alreadySettled: 0,
      failed: 0,
    };
    const limit = this.deps.pageSize ?? DEFAULT_PAGE_SIZE;
    let afterId: string | null = null;
    for (;;) {
      const page: AutomaticDebitEntry[] = await this.deps.source.page(afterId, limit);
      for (const entry of page) {
        summary.cards++;
        await this.processCard(entry, summary);
      }
      const last = page[page.length - 1];
      if (page.length < limit || !last) return summary;
      afterId = last.card.id;
    }
  }

  private async processCard(entry: AutomaticDebitEntry, summary: DebitSummary): Promise<void> {
    const { ownerId, timeZone, card } = entry;
    try {
      // An unknown zone name falls back to the stored default inside the shared time helpers.
      const local = instantToZonedLocal(this.deps.clock.now(), timeZone);
      const today = local.slice(0, 10);
      const lastDue = local.slice(11) >= AUTOMATIC_DEBIT_DUE_TIME ? today : addDays(today, -1);
      const scope = await this.deps.scopeFor(ownerId);
      const statements = await ensureStatements(this.deps.cards, scope, card, today);
      const settled = await this.deps.log.settledKeys(scope, card.id);
      const candidates = debitCandidates({
        statements,
        debitAccounts: card.debitAccounts,
        settled,
        lastDue,
      });
      for (const candidate of candidates) {
        await this.debitOne(scope, { timeZone, today }, card, candidate, summary);
      }
    } catch (error) {
      summary.failed++;
      this.deps.report({ cardId: card.id, period: null, currency: null, errorName: nameOf(error) });
    }
  }

  private async debitOne(
    scope: AccessScope<'write'>,
    { timeZone, today }: { timeZone: string; today: string },
    card: CreditCard,
    { statement, currency, link }: DebitCandidate,
    summary: DebitSummary,
  ): Promise<void> {
    const key = { cardId: card.id, period: statement.period, currency };
    try {
      const result = await this.deps.log.withClaim(scope, key, async () => {
        // The row is locked: read the state fresh, other payments may have arrived since the page.
        const statements = await this.deps.cards.listStatements(scope, card.id);
        const views = await buildStatementViews(
          this.deps,
          scope,
          card,
          statements,
          timeZone,
          today,
        );
        const view = views.find((candidate) => candidate.period === statement.period);
        // Not closed (dates edited meanwhile): leave the key unclaimed.
        if (!view?.payments) return null;
        const remainder = unpaidRemainder(view.totals[currency], view.payments[currency].paid);
        if (remainder === 0n) return { status: 'skipped', reason: 'covered' } as const;
        // Noon exists on every real day except one skipped calendar day (Samoa, 2011): UTC noon then.
        const occurredAt =
          zonedLocalToInstant(`${statement.dueDate}T12:00`, timeZone) ??
          new Date(`${statement.dueDate}T12:00:00.000Z`);
        try {
          const movement = await this.deps.recorder.recordOnce(
            scope,
            automaticDebitMovementId(card.id, statement.period, currency),
            {
              sourceAccountId: link.accountId,
              destinationAccountId: currency === 'ARS' ? card.arsAccountId : card.usdAccountId,
              amount: remainder,
              occurredAt,
            },
          );
          return { status: 'recorded', movementId: movement.id } as const;
        } catch (error) {
          // A domain refusal will not fix itself; a plain Error is transient and is rethrown.
          if (error instanceof AppError) return { status: 'skipped', reason: reasonOf(error) };
          throw error;
        }
      });
      if (!result.claimed) {
        summary.alreadySettled++;
      } else if (result.settlement) {
        this.count(summary, result.settlement);
        this.deps.info({
          event: result.settlement.status,
          ...key,
          ...(result.settlement.status === 'skipped' ? { reason: result.settlement.reason } : {}),
        });
      }
    } catch (error) {
      summary.failed++;
      this.deps.report({ ...key, errorName: nameOf(error) });
    }
  }

  private count(summary: DebitSummary, settlement: AutomaticDebitSettlement): void {
    if (settlement.status === 'recorded') summary.recorded++;
    else if (settlement.reason === 'covered') summary.skippedCovered++;
    else if (settlement.reason === 'account_unavailable') summary.skippedUnavailable++;
    else summary.skippedRefused++;
  }
}

/** An archived or missing debit account is "unavailable"; any other domain error is "refused" (FR-04). */
function reasonOf(error: AppError): AutomaticDebitSkipReason {
  return error.code === 'ACCOUNT_ARCHIVED' || error.code === 'NOT_FOUND'
    ? 'account_unavailable'
    : 'refused';
}

const nameOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
