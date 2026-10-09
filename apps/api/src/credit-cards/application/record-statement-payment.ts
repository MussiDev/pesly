import { AppError, MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { pesosForRate } from '../domain/statement-payment';
import type { CreditCardDependencies } from './dependencies';

export interface StatementPaymentInput {
  currency: 'ARS' | 'USD';
  sourceAccountId: string;
  /** What the card receives. */
  amount: bigint;
  /** A USD payment from an ARS account: the pesos debited, or the rate to derive them. */
  pesosAmount?: bigint;
  rate?: bigint;
  occurredAt: Date;
  note?: string;
}

export interface RecordedStatementPayment {
  movementId: string;
  sourceAccountId: string;
  accountId: string;
  currency: 'ARS' | 'USD';
  amount: bigint;
  exchange: { pesosAmount: bigint; rate: bigint } | null;
  occurredAt: Date;
}

function pesosDebited(input: StatementPaymentInput): bigint | undefined {
  if (input.currency === 'ARS' && (input.pesosAmount !== undefined || input.rate !== undefined)) {
    throw new AppError('VALIDATION_FAILED', 'Only a USD payment can carry pesos or a rate');
  }
  if (input.pesosAmount !== undefined) return input.pesosAmount;
  if (input.rate === undefined) return undefined;
  const pesos = pesosForRate(input.amount, input.rate);
  if (pesos < 1n || pesos > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) {
    throw new AppError('VALIDATION_FAILED', 'The rate gives pesos outside the allowed range');
  }
  return pesos;
}

export class RecordStatementPayment {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards' | 'paymentRecorder'>) {}

  /**
   * Records a transfer from the caller's account to the card's linked account of the currency
   * (FR-01), or an exchange when pesos of an ARS account pay the USD part. A missing or foreign
   * card: `ResourceNotFound`, before anything is recorded; the movement rules (currencies, open
   * accounts, no future date) propagate unchanged.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    input: StatementPaymentInput,
  ): Promise<RecordedStatementPayment> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const pesos = pesosDebited(input);
    const accountId = input.currency === 'ARS' ? card.arsAccountId : card.usdAccountId;
    const recorded = await this.deps.paymentRecorder.record(scope, {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: accountId,
      amount: input.amount,
      ...(pesos === undefined ? {} : { pesosDebited: pesos }),
      occurredAt: input.occurredAt,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return {
      movementId: recorded.id,
      sourceAccountId: input.sourceAccountId,
      accountId,
      currency: input.currency,
      amount: input.amount,
      exchange: recorded.exchange,
      occurredAt: recorded.occurredAt,
    };
  }
}
