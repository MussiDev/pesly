import type { AccountCurrency, ExpenseSnapshot, GroupSplitMode, RateType } from '@pesly/shared';
import type { DefaultSplit, GroupExpense, PersonalShare } from '../../domain/group-expense';
import type { PayerMovementToRecord } from './payer-movement-recorder';

export interface NewGroupExpenseShare {
  memberId: string;
  amount: bigint;
  basisPoints: number | null;
}

/** The log entry written with the expense (spec D10); `createdAt` comes from the `Clock`. */
export interface NewExpenseActivity {
  action: 'expense_created';
  memberId: string;
  createdAt: Date;
}

export interface NewGroupExpense {
  groupId: string;
  payerMemberId: string;
  createdByMemberId: string;
  amount: bigint;
  currency: AccountCurrency;
  occurredAt: Date;
  categoryId: string;
  description: string;
  splitMode: GroupSplitMode;
  /** Shares already allocated: they add up to `amount`. */
  shares: NewGroupExpenseShare[];
  activity: NewExpenseActivity;
  /** Set only when the caller is the payer; recorded in the same transaction. */
  payerMovement: PayerMovementToRecord | null;
}

/**
 * The log entry written with an edit or a deletion (spec D7). `before` is the snapshot the use
 * case read; `after` is the snapshot of the new values and null for a deletion. `createdAt` comes
 * from the `Clock`.
 */
export interface ExpenseChangeActivity {
  action: 'expense_updated' | 'expense_deleted';
  memberId: string;
  createdAt: Date;
  before: ExpenseSnapshot;
  after: ExpenseSnapshot | null;
}

/**
 * A full replacement of the editable fields (spec D2): currency, payer and creator stay as stored.
 */
export interface UpdateGroupExpenseData {
  groupId: string;
  expenseId: string;
  amount: bigint;
  occurredAt: Date;
  categoryId: string;
  description: string;
  splitMode: GroupSplitMode;
  /** Shares already allocated: they add up to `amount`. They replace the stored ones. */
  shares: NewGroupExpenseShare[];
  /** The group's default rate type, for the payer movement rewrite (spec D6). */
  rateType: RateType;
  activity: ExpenseChangeActivity & { action: 'expense_updated'; after: ExpenseSnapshot };
}

export interface DeleteGroupExpenseData {
  groupId: string;
  expenseId: string;
  rateType: RateType;
  activity: ExpenseChangeActivity & { action: 'expense_deleted'; after: null };
}

export interface ListExpensesQuery {
  limit: number;
  /** Opaque; produced by a previous page. */
  cursor?: string;
}

export interface ListPersonalSharesQuery {
  limit: number;
  cursor?: string;
  /** Inclusive UTC bounds on `occurredAt`. */
  from?: Date;
  to?: Date;
}

export interface GroupExpensePageResult {
  items: GroupExpense[];
  nextCursor: string | null;
}

export interface PersonalSharesPageResult {
  items: PersonalShare[];
  nextCursor: string | null;
}

/**
 * Newest first (`occurred_at desc, id desc`), keyset pages. Every read is scoped by group id (or,
 * for the personal view, by the user's own member rows); the use case checks membership first.
 */
export interface GroupExpenseRepository {
  /**
   * One transaction: the expense, its shares, the log row and, when `payerMovement` is set, the
   * movement through the `PayerMovementRecorder` on the same unit of work; the movement id lands
   * in `payerMovementId`. Any failure leaves nothing behind.
   */
  saveExpense(data: NewGroupExpense): Promise<GroupExpense>;
  /**
   * One transaction under the group row `for share` (spec D4): load the expense in the group
   * (`ResourceNotFound` when it is gone), recompute under lock which members' balances change
   * (`expenseChangedMembers`) and throw `GroupRecordFormerMember` when one of them is no longer an
   * active member, replace the fields and the shares, insert the log row with `before` taken from
   * the row read under lock (spec D10) and, when `payerMovementId` is set, call
   * `PayerMovementRecorder.update` on the same unit under the payer's own scope (spec D6). A null
   * `payerMovementId` touches no movement. Any failure leaves nothing behind.
   */
  updateExpense(data: UpdateGroupExpenseData): Promise<GroupExpense>;
  /**
   * Same locks and checks as `updateExpense` with no new values: the expense and its shares go,
   * the log row is written, and `PayerMovementRecorder.remove` runs when `payerMovementId` is set.
   */
  deleteExpense(data: DeleteGroupExpenseData): Promise<void>;
  listExpenses(groupId: string, query: ListExpensesQuery): Promise<GroupExpensePageResult>;
  /** Null when the expense does not exist or belongs to another group. */
  getExpense(groupId: string, expenseId: string): Promise<GroupExpense | null>;
  /** Expenses where the user's member rows pay or hold a share, across groups. */
  listPersonalShares(
    userId: string,
    query: ListPersonalSharesQuery,
  ): Promise<PersonalSharesPageResult>;
  getDefaultSplit(groupId: string): Promise<DefaultSplit>;
  /** Replaces the whole default split. */
  setDefaultSplit(groupId: string, split: DefaultSplit): Promise<DefaultSplit>;
}
