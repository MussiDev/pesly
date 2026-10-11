import type { AccessScope } from '../../../shared/access';

export interface AutomaticDebitTransfer {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: bigint;
  occurredAt: Date;
}

/**
 * Records a transfer under a caller-chosen id, without spending a creation limit unit (it is a
 * system action). Recording the same id again returns the stored movement instead of a new one.
 * The movements module implements it so every rule of PRD 03 applies unchanged.
 */
export interface AutomaticDebitRecorder {
  recordOnce(
    scope: AccessScope<'write'>,
    movementId: string,
    transfer: AutomaticDebitTransfer,
  ): Promise<{ id: string }>;
}
