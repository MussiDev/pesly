import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { CreditCardDependencies } from './dependencies';

export interface StatementPaymentInput {
  currency: 'ARS' | 'USD';
  sourceAccountId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
}

export interface RecordedStatementPayment {
  movementId: string;
  sourceAccountId: string;
  accountId: string;
  currency: 'ARS' | 'USD';
  amount: bigint;
  occurredAt: Date;
}

export class RecordStatementPayment {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards' | 'paymentRecorder'>) {}

  /**
   * Records a transfer from the caller's account to the card's linked account of the currency
   * (FR-01). A missing or foreign card: `ResourceNotFound`, before anything is recorded; the
   * transfer rules (same currency, open accounts, no future date) propagate unchanged.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    input: StatementPaymentInput,
  ): Promise<RecordedStatementPayment> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const accountId = input.currency === 'ARS' ? card.arsAccountId : card.usdAccountId;
    const recorded = await this.deps.paymentRecorder.record(scope, {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: accountId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return {
      movementId: recorded.id,
      sourceAccountId: input.sourceAccountId,
      accountId,
      currency: input.currency,
      amount: input.amount,
      occurredAt: recorded.occurredAt,
    };
  }
}
