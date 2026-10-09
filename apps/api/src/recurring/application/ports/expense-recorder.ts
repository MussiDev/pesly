import type { AccessScope } from '../../../shared/access';

export interface ExpenseToRecord {
  accountId: string;
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
  rate: { source: 'automatic' } | { source: 'manual'; value: bigint };
}

/**
 * Records an expense movement on an account; the movements module implements it so every movement
 * rule applies unchanged (spec: a confirmed or automatic occurrence is a normal expense).
 */
export interface ExpenseRecorder {
  record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }>;
}
