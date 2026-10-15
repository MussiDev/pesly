export interface BalanceAdjustmentRequest {
  /** The owner from the caller's scope; the adapter uses it in every query. */
  ownerId: string;
  accountId: string;
  /** The balance the account should have after the adjustment (signed minor units). */
  target: bigint;
  note: string | null;
}

/** The adjustment as stored: a signed, non-zero amount in the account's currency. */
export interface RecordedAdjustment {
  id: string;
  accountId: string;
  amount: bigint;
  occurredAt: Date;
  note: string | null;
  createdAt: Date;
}

/**
 * `not_found`: no account of that owner. `archived` and `credit_card` refuse the adjustment (a
 * card is checked first, even when archived). `adjusted`: `balance` is the balance after the call;
 * `adjustment` is null when the target already equalled the balance.
 */
export type BalanceAdjustmentResult =
  | { status: 'adjusted'; balance: bigint; adjustment: RecordedAdjustment | null }
  | { status: 'not_found' }
  | { status: 'archived' }
  | { status: 'credit_card' }
  /** `target - current` exceeds the largest amount a movement can hold; nothing is written. */
  | { status: 'out_of_range' };

/**
 * The door through which the accounts module asks the movements module to record a balance
 * adjustment. The adapter locks the account row, computes the current balance after the lock and
 * inserts `target - current` in the same transaction, so concurrent calls never lose an update.
 */
export interface BalanceAdjuster {
  adjust(request: BalanceAdjustmentRequest): Promise<BalanceAdjustmentResult>;
}
