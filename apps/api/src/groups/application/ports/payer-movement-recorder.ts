import type { AccountCurrency, RateType } from '@pesly/shared';

/** What the use case asks before writing: is this account and category usable by this user. */
export interface PayerAccountCheck {
  userId: string;
  accountId: string;
  categoryId: string;
  currency: AccountCurrency;
}

/** The expense movement of the full amount on the payer account (spec D6). */
export interface PayerMovementToRecord {
  userId: string;
  accountId: string;
  /** One of the payer's personal expense categories. */
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
  /** The expense description. */
  note: string;
  /** The group's default rate type; the adapter resolves the stored rate for it. */
  rateType: RateType;
}

/** The expense edit as it reaches the payer's movement (spec D6): same account and category. */
export interface PayerMovementUpdate {
  /** The payer's user: the movement is written under this user's scope, never the editor's. */
  userId: string;
  movementId: string;
  amount: bigint;
  /** Clamped by the adapter like at creation. */
  occurredAt: Date;
  /** The expense description. */
  note: string;
  rateType: RateType;
}

export interface PayerMovementRemoval {
  userId: string;
  movementId: string;
}

/**
 * Groups-side port over `accounts`, `categories` and `movements`. `Tx` is the unit of work the
 * repository opened (a Drizzle transaction): the repository calls `record` with it, so the
 * movement and the expense commit or roll back together.
 */
export interface PayerMovementRecorder<Tx = unknown> {
  /**
   * True when the account is one of the user's, in the given currency, and the category is one of
   * the user's personal expense categories. Read-only; may run outside the transaction.
   */
  isUsable(check: PayerAccountCheck): Promise<boolean>;
  /** Inserts the movement inside `unit` and returns its id. Never opens its own transaction. */
  record(unit: Tx, movement: PayerMovementToRecord): Promise<{ id: string }>;
  /**
   * Rewrites the movement inside `unit` under the payer's scope (spec D6): new amount, date and
   * note on the same account and category. A movement that no longer exists is a no-op.
   */
  update(unit: Tx, change: PayerMovementUpdate): Promise<void>;
  /** Deletes the movement inside `unit` under the payer's scope; a missing one is a no-op. */
  remove(unit: Tx, removal: PayerMovementRemoval): Promise<void>;
}
