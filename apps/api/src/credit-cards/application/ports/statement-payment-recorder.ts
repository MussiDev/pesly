import type { AccessScope } from '../../../shared/access';

export interface PaymentToRecord {
  sourceAccountId: string;
  destinationAccountId: string;
  /** What the destination receives. */
  amount: bigint;
  /**
   * Pesos leaving the source when an ARS account pays a USD destination: the payment is then a
   * currency exchange. Absent for a transfer; refused for a source that needs none.
   */
  pesosDebited?: bigint;
  occurredAt: Date;
  note?: string;
}

export interface RecordedPaymentMovement {
  id: string;
  occurredAt: Date;
  /** Set when the movement was an exchange: the pesos debited and the frozen implied rate. */
  exchange: { pesosAmount: bigint; rate: bigint } | null;
}

/**
 * Records a transfer between two accounts, or an exchange when pesos are debited for USD; the
 * movements module implements it so every rule of PRD 03 applies unchanged (spec D5, D6).
 */
export interface StatementPaymentRecorder {
  record(scope: AccessScope<'write'>, payment: PaymentToRecord): Promise<RecordedPaymentMovement>;
}
