import {
  AppError,
  BASIS_POINTS_TOTAL,
  SplitPercentageInvalidError,
  type AccountCurrency,
  type GroupSplitMode,
} from '@pesly/shared';
import type { Member } from './member';

/** An expense may be dated at most this far ahead of the clock (spec D13). */
export const EXPENSE_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export interface GroupExpenseShare {
  memberId: string;
  amount: bigint;
  /** Set only for a percentage split. */
  basisPoints: number | null;
}

export interface GroupExpense {
  id: string;
  groupId: string;
  payerMemberId: string;
  createdByMemberId: string;
  amount: bigint;
  currency: AccountCurrency;
  occurredAt: Date;
  categoryId: string;
  description: string;
  splitMode: GroupSplitMode;
  /** Null when the payer is a ghost or another member, or after the movement was erased. */
  payerMovementId: string | null;
  createdAt: Date;
  shares: GroupExpenseShare[];
}

/** The default split of a group; `equal` means all current members and stores no rows (spec D8). */
export type DefaultSplit =
  { mode: 'equal' } | { mode: 'percentage'; shares: { memberId: string; basisPoints: number }[] };

/** One expense of a user's personal view (spec D7); amounts are never converted. */
export interface PersonalShare {
  expenseId: string;
  groupId: string;
  currency: AccountCurrency;
  occurredAt: Date;
  /** 0 when the user paid but is not in the split. */
  shareAmount: bigint;
  /** Only for the payer: amount minus the payer's own share. */
  receivableAmount: bigint | null;
}

/** A split member or the payer does not belong to the group (spec D4). */
export class GroupSplitMemberInvalid extends AppError {
  constructor() {
    super('GROUP_SPLIT_MEMBER_INVALID');
  }
}

/** The category is not a non-archived category of the group (spec D9). */
export class GroupExpenseCategoryInvalid extends AppError {
  constructor() {
    super('GROUP_EXPENSE_CATEGORY_INVALID');
  }
}

/** The payer account is missing, sent for the wrong payer, or not usable (spec D5). */
export class GroupPayerAccountInvalid extends AppError {
  constructor() {
    super('GROUP_PAYER_ACCOUNT_INVALID');
  }
}

/** The expense is dated more than 1 day after the clock (400 `VALIDATION_FAILED`, spec D13). */
export class ExpenseDateTooFarAhead extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The expense date is more than 1 day in the future', [
      'body.occurredAt',
    ]);
  }
}

/** The expense amount is zero or negative (400 `VALIDATION_FAILED`, spec D13). */
export class ExpenseAmountNotPositive extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The expense amount must be positive', ['body.amount']);
  }
}

/** Basis points must add up to exactly 10,000; the error reports the total they do add up to. */
export function assertBasisPointsTotal(shares: readonly { basisPoints: number }[]): void {
  const total = shares.reduce((sum, share) => sum + share.basisPoints, 0);
  if (total !== BASIS_POINTS_TOTAL) throw new SplitPercentageInvalidError(total);
}

export function isTooFarAhead(occurredAt: Date, now: Date): boolean {
  return occurredAt.getTime() > now.getTime() + EXPENSE_MAX_FUTURE_MS;
}

/**
 * The leftover order of spec D3: the payer first when in the split, then the rest by `joinedAt`
 * and `id`, so the leftover minor units are deterministic.
 */
export function orderSplitMembers(
  payerMemberId: string,
  splitMemberIds: readonly string[],
  members: readonly Member[],
): string[] {
  const inSplit = new Set(splitMemberIds);
  const rest = members
    .filter((member) => inSplit.has(member.id) && member.id !== payerMemberId)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.id < b.id ? -1 : 1))
    .map((member) => member.id);
  return inSplit.has(payerMemberId) ? [payerMemberId, ...rest] : rest;
}
