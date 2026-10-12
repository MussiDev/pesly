import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  ExpenseSummaryRange,
  ExpenseSummaryRow,
  GroupExpenseSummaryReader,
} from '../../application/ports/group-expense-summary-reader';
import { groupExpenses } from './schema';

export class DrizzleGroupExpenseSummaryReader implements GroupExpenseSummaryReader {
  constructor(private readonly db: Database) {}

  async summarize(groupId: string, range: ExpenseSummaryRange): Promise<ExpenseSummaryRow[]> {
    // `sum(bigint)` is numeric in PostgreSQL, so it cannot overflow; it travels as text.
    const rows = await this.db
      .select({
        currency: groupExpenses.currency,
        categoryId: groupExpenses.categoryId,
        total: sql<string>`sum(${groupExpenses.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(groupExpenses)
      .where(
        and(
          eq(groupExpenses.groupId, groupId),
          gte(groupExpenses.occurredAt, range.from),
          lte(groupExpenses.occurredAt, range.to),
        ),
      )
      .groupBy(groupExpenses.currency, groupExpenses.categoryId);
    return rows.map((row) => ({
      currency: row.currency,
      categoryId: row.categoryId,
      total: BigInt(row.total),
      count: row.count,
    }));
  }
}
