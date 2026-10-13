import type { AccountCurrency, MovementType, RateType } from '@pesly/shared';

/** A movement the caller owns, as the send-to-group use case reads it (spec 05i D2). */
export interface AdoptableMovement {
  id: string;
  type: MovementType;
  amount: bigint;
  /** The currency of the movement's account. */
  currency: AccountCurrency;
  occurredAt: Date;
  note: string | null;
  /** The movement's own personal category; null for an income. */
  categoryId: string | null;
  /** That category's default key (`food`, `food.groceries`); null for a custom one. */
  categoryDefaultKey: string | null;
  /** True when a group expense already points at the movement. */
  linked: boolean;
}

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
  /** Adopted expenses never carry the note: the movement's own note is written back (spec 05i D6). */
  keepNote?: boolean;
}

/** One of the payer's own expense movements that could be adopted by an expense (FEAT-008). */
export interface MovementCandidateRow {
  id: string;
  amount: bigint;
  occurredAt: Date;
  note: string | null;
  accountId: string;
  accountName: string;
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
  /**
   * Reads one of the user's movements to decide whether it can be sent to a group; null when it is
   * missing, not the user's, or its account is not the user's. Read-only, no lock.
   */
  peekAdoptable(userId: string, movementId: string): Promise<AdoptableMovement | null>;
  /** Same read as `peekAdoptable`, inside `unit` with the movement row `for update`. */
  lockForAdoption(unit: Tx, userId: string, movementId: string): Promise<AdoptableMovement | null>;
  /**
   * The user's own expense movements of that amount, on an account of that currency, that no group
   * expense holds, newest first, at most `limit`. Read-only, no lock (FEAT-008).
   */
  listCandidates(
    userId: string,
    query: { amount: bigint; currency: AccountCurrency; limit: number },
  ): Promise<MovementCandidateRow[]>;
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
