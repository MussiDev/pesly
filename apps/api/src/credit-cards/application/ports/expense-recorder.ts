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
 * rule applies unchanged (spec D7).
 */
export interface ExpenseRecorder {
  record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }>;
  /**
   * The same recording without spending a unit of the creation limit. Only for a caller that has
   * taken its own unit for the whole request, like the statement import (one unit for up to 300
   * lines); every other movement rule still applies.
   */
  recordUnmetered(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }>;
}
