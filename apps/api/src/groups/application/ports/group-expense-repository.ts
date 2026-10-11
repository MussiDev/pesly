import type { AccountCurrency, GroupSplitMode } from '@pesly/shared';
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
