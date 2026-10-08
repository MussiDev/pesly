import type { AccessScope } from '../../../shared/access';

export interface PaymentToRecord {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
}

/**
 * Records a transfer between two accounts; the movements module implements it so every transfer
 * rule of PRD 03 applies unchanged (spec D5, D6).
 */
export interface StatementPaymentRecorder {
  record(
    scope: AccessScope<'write'>,
    payment: PaymentToRecord,
  ): Promise<{ id: string; occurredAt: Date }>;
}
