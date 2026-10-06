import { dateInTimeZone } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { assignStatement } from '../domain/statement-assignment';
import { zoneAndToday, type CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';
import type { ExpenseToRecord } from './ports/expense-recorder';

export interface CardExpenseInput {
  currency: 'ARS' | 'USD';
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
  rate: ExpenseToRecord['rate'];
}

export interface RecordedCardExpense {
  movementId: string;
  accountId: string;
  currency: 'ARS' | 'USD';
  amount: bigint;
  occurredAt: Date;
  statementId: string | null;
}

export class RecordCardExpense {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'expenses'
    >,
  ) {}

  /**
   * Records an expense on the card's linked account of the chosen currency (FR-01). The statement
   * is derived from the purchase's local day, never stored (spec D2). Missing or foreign card:
   * `ResourceNotFound`, before anything is recorded; movement rule failures propagate unchanged.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    input: CardExpenseInput,
  ): Promise<RecordedCardExpense> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const accountId = input.currency === 'ARS' ? card.arsAccountId : card.usdAccountId;
    const { timeZone, today } = await zoneAndToday(this.deps, scope.userId);
    const statements = await ensureStatements(this.deps.cards, scope, card, today);

    const expense: ExpenseToRecord = {
      accountId,
      categoryId: input.categoryId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      rate: input.rate,
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    const recorded = await this.deps.expenses.record(scope, expense);

    const statement = assignStatement(dateInTimeZone(recorded.occurredAt, timeZone), statements);
    return {
      movementId: recorded.id,
      accountId,
      currency: input.currency,
      amount: input.amount,
      occurredAt: recorded.occurredAt,
      statementId: statement?.id ?? null,
    };
  }
}
