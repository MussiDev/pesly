import type { AccountCurrency } from '@pesly/shared';
import type {
  ExpenseSummaryRange,
  ExpenseSummaryRow,
  GroupExpenseSummaryReader,
} from '../../src/groups/application/ports/group-expense-summary-reader';

/** Returns the rows the test sets, in the order given, and records every call. */
export class FakeSummaryReader implements GroupExpenseSummaryReader {
  rows: ExpenseSummaryRow[] = [];
  readonly calls: { groupId: string; range: ExpenseSummaryRange }[] = [];

  async summarize(groupId: string, range: ExpenseSummaryRange): Promise<ExpenseSummaryRow[]> {
    await Promise.resolve();
    this.calls.push({ groupId, range });
    return [...this.rows];
  }
}

export function summaryRow(
  currency: AccountCurrency,
  categoryId: string,
  total: bigint,
  count = 1,
): ExpenseSummaryRow {
  return { currency, categoryId, total, count };
}
