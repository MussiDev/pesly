import { and, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  BucketedPersonalRow,
  BucketedShareRow,
  SpendingBucket,
  SpendingReader,
  SpendingWindow,
} from '../../application/ports/spending-reader';
import {
  accounts,
  groupCategories,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
  movements,
} from './foreign-relations';

/** The instants are bound as ISO text, so the driver never formats a `Date` in the server zone. */
const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** The earliest instant of the window and the end of the current month: `[from, to)`. */
function span(window: SpendingWindow): { from: Date; to: Date } {
  return { from: (window.previous ?? window.current).from, to: window.current.to };
}

/**
 * The bucket a timestamp falls in. The windows are contiguous, so everything inside the span that
 * is not in the current month is in the previous one.
 */
function bucketOf(column: AnyPgColumn, window: SpendingWindow) {
  return sql<SpendingBucket>`case when ${column} >= ${instant(window.current.from)} then 'current' else 'previous' end`;
}

export class DrizzleSpendingReader implements SpendingReader {
  constructor(private readonly db: Database) {}

  async personalSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
  ): Promise<BucketedPersonalRow[]> {
    if (categoryIds.length === 0) return [];
    const { from, to } = span(window);
    const rows = await this.db
      .select({
        categoryId: movements.categoryId,
        bucket: bucketOf(movements.occurredAt, window),
        currency: accounts.currency,
        rate: movements.rate,
        // Read as text and parsed with BigInt: a bigint sum must never pass through a number.
        sum: sql<string>`sum(${movements.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(movements)
      .innerJoin(
        accounts,
        and(eq(accounts.id, movements.accountId), eq(accounts.ownerId, movements.ownerId)),
      )
      .where(
        and(
          scopedTo(scope, { owner: movements.ownerId }),
          eq(movements.type, 'expense'),
          inArray(movements.categoryId, [...categoryIds]),
          gte(movements.occurredAt, instant(from)),
          lt(movements.occurredAt, instant(to)),
          // The payer movement of a group expense is counted through the payer's share instead.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(groupExpenses)
              .where(eq(groupExpenses.payerMovementId, movements.id)),
          ),
        ),
      )
      // Ordinals: the bucket expression carries bound parameters, so it cannot be repeated here.
      .groupBy(sql.raw('1, 2, 3, 4'));

    return rows.map((row) => {
      if (row.categoryId === null) throw new Error('An expense movement has no category');
      return {
        categoryId: row.categoryId,
        bucket: row.bucket,
        currency: row.currency,
        rate: row.rate,
        sum: BigInt(row.sum),
        count: row.count,
      };
    });
  }

  async shareSpending(scope: AccessScope, window: SpendingWindow): Promise<BucketedShareRow[]> {
    assertIssuedScope(scope);
    const { from, to } = span(window);
    // The same rule as `GET /groups/personal/shares`: the caller's member row paid the expense or
    // holds a share of it. The group tables are reached only through the caller's member rows.
    const rows = await this.db
      .select({
        categoryName: groupCategories.name,
        categoryDefaultKey: groupCategories.defaultKey,
        bucket: bucketOf(groupExpenses.occurredAt, window),
        currency: groupExpenses.currency,
        // The caller's own payer movement; null when someone else paid.
        rate: movements.rate,
        sum: sql<string>`sum(${groupExpenseShares.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(groupMembers)
      .innerJoin(groupExpenses, eq(groupExpenses.groupId, groupMembers.groupId))
      .innerJoin(groupCategories, eq(groupCategories.id, groupExpenses.categoryId))
      .innerJoin(
        groupExpenseShares,
        and(
          eq(groupExpenseShares.expenseId, groupExpenses.id),
          eq(groupExpenseShares.memberId, groupMembers.id),
        ),
      )
      .leftJoin(
        movements,
        and(eq(movements.id, groupExpenses.payerMovementId), eq(movements.ownerId, scope.userId)),
      )
      .where(
        and(
          eq(groupMembers.userId, scope.userId),
          sql`${groupExpenseShares.amount} > 0`,
          gte(groupExpenses.occurredAt, instant(from)),
          lt(groupExpenses.occurredAt, instant(to)),
        ),
      )
      .groupBy(sql.raw('1, 2, 3, 4, 5'), groupCategories.id);

    return rows.map((row) => ({
      categoryName: row.categoryName,
      categoryDefaultKey: row.categoryDefaultKey,
      bucket: row.bucket,
      currency: row.currency,
      rate: row.rate,
      sum: BigInt(row.sum),
      count: row.count,
    }));
  }
}
