import type { AccountCurrency } from '@pesly/shared';
import { InvalidGoalInput } from './errors';

/** A savings goal. Money is in minor units; `targetDate` is a `YYYY-MM-DD` calendar day. */
export interface Goal {
  id: string;
  name: string;
  targetAmount: bigint;
  currency: AccountCurrency;
  targetDate: string | null;
  /** Set only at creation; a linked goal's progress is the account balance. */
  accountId: string | null;
  createdAt: Date;
}

export type GoalEntryKind = 'contribution' | 'withdrawal';

/** A manual contribution or withdrawal of a goal that is not linked to an account. */
export interface GoalEntry {
  id: string;
  kind: GoalEntryKind;
  amount: bigint;
  createdAt: Date;
}

/** Per-user cap on goals (FR-14). */
export const MAX_GOALS = 100;

export const GOAL_NAME_MAX_LENGTH = 80;

/** The largest request amount; progress of unlinked goals never goes above it, so sums fit int64. */
export const MAX_GOAL_PROGRESS = 9_999_999_999_999_999n;

/** Name rules of the contract, repeated here so a use case never stores what the schema would refuse. */
export function assertGoalName(name: string): void {
  const length = Array.from(name.trim()).length;
  if (length < 1 || length > GOAL_NAME_MAX_LENGTH) throw new InvalidGoalInput('body.name');
}

/** Positive and inside the largest request amount. */
export function assertGoalAmount(amount: bigint, field: string): void {
  if (amount <= 0n || amount > MAX_GOAL_PROGRESS) throw new InvalidGoalInput(field);
}
