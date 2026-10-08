import {
  nextPeriod,
  statementDatesFor,
  zonedLocalToInstant,
  type AccountCurrency,
} from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { CreditCard, StatementDraft } from '../domain/credit-card';
import {
  firstPeriodOfInstallment,
  fingerprintLines,
  noteFromDescription,
} from '../domain/statement-import';
import type { CreateInstallmentPurchase } from './create-installment-purchase';
import { zoneAndToday, type CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';
import { RecordCardExpense } from './record-card-expense';

export interface StatementImportLineInput {
  /** Calendar day of the purchase, `YYYY-MM-DD`. */
  date: string;
  description: string;
  voucher: string | null;
  currency: AccountCurrency;
  /** Minor units of this statement's installment (or of the whole purchase). */
  amount: bigint;
  installmentNumber: number | null;
  installmentCount: number | null;
}

export interface StatementImportInput {
  /** Closing date of the imported statement. */
  closingDate: string;
  dueDate?: string;
  categoryId: string;
  lines: readonly StatementImportLineInput[];
}

export interface StatementImportResult {
  created: number;
  skipped: number;
  createdExpenses: number;
  createdInstallmentPurchases: number;
}

/** The most cycles an import may add before the first stored statement. */
const MAX_BACKFILLED_STATEMENTS = 36;

/**
 * Imports the lines of a parsed card statement (one category for all of them).
 *
 * - A missing or foreign card is `ResourceNotFound` and the category is checked, both before
 *   anything is stored.
 * - The whole request spends ONE unit of the creation limit, not one per line (up to 300 lines).
 *   The unit is refunded when nothing was created.
 * - Lines are idempotent through their fingerprints: a line whose fingerprint exists is skipped,
 *   so importing the same file twice creates nothing the second time.
 * - Atomicity: each line is created on its own (an expense is a movement, an installment purchase
 *   has its own transaction), so a failure half way leaves the earlier lines created. The
 *   fingerprint is claimed before the line is created and given back when creating it fails, so
 *   retrying the same file only creates what is missing.
 */
export class ImportCardStatement {
  private readonly recordExpense: RecordCardExpense;

  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      | 'cards'
      | 'timeZones'
      | 'clock'
      | 'expenses'
      | 'categories'
      | 'writeLimit'
      | 'statementImports'
    >,
    private readonly createPurchase: CreateInstallmentPurchase,
  ) {
    // Expenses go through the same use case as `POST /credit-cards/:id/expenses`, on the recorder
    // path that does not spend a limit unit per line.
    const unmetered = (
      ...args: Parameters<typeof deps.expenses.recordUnmetered>
    ): ReturnType<typeof deps.expenses.recordUnmetered> => deps.expenses.recordUnmetered(...args);
    this.recordExpense = new RecordCardExpense({
      cards: deps.cards,
      timeZones: deps.timeZones,
      clock: deps.clock,
      expenses: { record: unmetered, recordUnmetered: unmetered },
    });
  }

  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    input: StatementImportInput,
  ): Promise<StatementImportResult> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    await this.deps.categories.assertOpenExpenseCategory(scope, input.categoryId);

    const unit = await this.deps.writeLimit.take(scope);
    const result: StatementImportResult = {
      created: 0,
      skipped: 0,
      createdExpenses: 0,
      createdInstallmentPurchases: 0,
    };
    try {
      const { timeZone, today } = await zoneAndToday(this.deps, scope.userId);
      await this.ensureImportedStatement(scope, card, input, today);

      const fingerprints = fingerprintLines(input.lines);
      const period = input.closingDate.slice(0, 7);
      for (const [index, line] of input.lines.entries()) {
        const fingerprint = fingerprints[index];
        if (fingerprint === undefined) continue;
        if (!(await this.deps.statementImports.claim(scope, card.id, fingerprint))) {
          result.skipped += 1;
          continue;
        }
        try {
          const note = noteFromDescription(line.description);
          if (line.installmentCount !== null && line.installmentNumber !== null) {
            await this.createPurchase.createUnmetered(scope, card.id, {
              categoryId: input.categoryId,
              currency: line.currency,
              amount: line.amount * BigInt(line.installmentCount),
              installments: line.installmentCount,
              purchasedOn: line.date,
              firstPeriod: firstPeriodOfInstallment(period, line.installmentNumber),
              ...(note === undefined ? {} : { note }),
            });
            result.createdInstallmentPurchases += 1;
          } else {
            await this.recordExpense.execute(scope, card.id, {
              currency: line.currency,
              categoryId: input.categoryId,
              amount: line.amount,
              occurredAt: occurredAtOf(line.date, today, timeZone, this.deps.clock.now()),
              rate: { source: 'automatic' },
              ...(note === undefined ? {} : { note }),
            });
            result.createdExpenses += 1;
          }
          result.created += 1;
        } catch (error) {
          await this.deps.statementImports.release(scope, card.id, fingerprint);
          throw error;
        }
      }
      return result;
    } catch (error) {
      // Lines already created keep their unit: only an import that created nothing is refunded.
      if (result.created === 0) await unit.release();
      throw error;
    }
  }

  /**
   * Makes sure the imported statement's cycle exists, so its lines are not assigned to a later
   * cycle just because the card has no earlier one: when the file's cycle is older than the card's
   * first stored statement, the cycles from it up to that one are created (the file's own dates
   * for the imported cycle, the card's default days for the ones between).
   */
  private async ensureImportedStatement(
    scope: AccessScope<'write'>,
    card: CreditCard,
    input: StatementImportInput,
    today: string,
  ): Promise<void> {
    const statements = await ensureStatements(this.deps.cards, scope, card, today);
    const earliest = statements[0];
    const period = input.closingDate.slice(0, 7);
    if (earliest === undefined || period >= earliest.period) return;

    const drafts: StatementDraft[] = [];
    for (let next = period; next < earliest.period; next = nextPeriod(next)) {
      if (drafts.length >= MAX_BACKFILLED_STATEMENTS) return;
      const dates =
        next === period && input.dueDate !== undefined
          ? { closingDate: input.closingDate, dueDate: input.dueDate }
          : statementDatesFor(next, card.closingDay, card.dueDay);
      drafts.push({ period: next, ...dates });
    }
    await this.deps.cards.insertStatements(scope, card.id, drafts);
  }
}

/** Midday of the line's day in the user's zone, or now for today so it is never in the future. */
function occurredAtOf(date: string, today: string, timeZone: string, now: Date): Date {
  if (date === today) return now;
  return zonedLocalToInstant(`${date}T12:00`, timeZone) ?? new Date(`${date}T12:00:00Z`);
}
