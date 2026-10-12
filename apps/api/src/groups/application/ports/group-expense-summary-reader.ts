import type { AccountCurrency } from '@pesly/shared';

export interface ExpenseSummaryRange {
  /** Inclusive UTC bounds on `occurredAt`. */
  from: Date;
  to: Date;
}

/** One aggregate row: the expenses of one currency and one category inside the range. */
export interface ExpenseSummaryRow {
  currency: AccountCurrency;
  categoryId: string;
  /** Minor units; a sum can exceed the safe integer range, so it is never a number. */
  total: bigint;
  count: number;
}

export interface GroupExpenseSummaryReader {
  /** Every expense in the range, not a page; the order of the rows is not defined. */
  summarize(groupId: string, range: ExpenseSummaryRange): Promise<ExpenseSummaryRow[]>;
}
