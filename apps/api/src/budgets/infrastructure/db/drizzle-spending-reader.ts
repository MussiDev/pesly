import { databaseTimeZone, statementDueMonth } from '@pesly/shared';
import { and, asc, eq, gte, inArray, lt, lte, notExists, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  BucketedPersonalRow,
  BucketedShareRow,
  SpendingBucket,
  SpendingInterval,
  StatementCardPurchaseRow,
  StatementInstallmentRow,
  SpendingReader,
  SpendingWindow,
} from '../../application/ports/spending-reader';
import type { StatementPlacement } from '../../domain/spending';
import {
  accounts,
  creditCardStatements,
  creditCards,
  groupCategories,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
  installmentPurchases,
  installments,
  movements,
} from './foreign-relations';

interface CardPurchaseSqlRow extends Record<string, unknown> {
  period: string;
  due_date: string | null;
  closing_day: number;
  due_day: number;
  category_id: string;
  currency: 'ARS' | 'USD';
  rate: string | null;
  sum: string;
  count: number;
}

/**
 * The first and last month (`YYYY-MM`) the window covers. A bound is midnight of a month in the
 * user's zone, which in UTC can fall in the neighbouring month, so the month is read at the middle
 * of its interval: a month lasts at least 28 days and zones are within 14 hours of UTC.
 */
function dueMonthsOf(window: SpendingWindow): { first: string; last: string } {
  const middle = (interval: SpendingInterval) =>
    new Date((interval.from.getTime() + interval.to.getTime()) / 2).toISOString().slice(0, 7);
  return { first: middle(window.previous ?? window.current), last: middle(window.current) };
}

function shiftMonth(month: string, by: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + by;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The rows the use case buckets: the statement's due month is one of the window's months. */
function isDueWithin(row: StatementPlacement, months: { first: string; last: string }): boolean {
  const due = statementDueMonth(row);
  return due >= months.first && due <= months.last;
}

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

  async cardPurchaseSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
    timeZone: string,
  ): Promise<StatementCardPurchaseRow[]> {
    if (categoryIds.length === 0) return [];
    const zone = databaseTimeZone(timeZone);
    // The purchase's calendar day in the user's zone, as the statements' closing dates are days.
    const day = sql`(${movements.occurredAt} at time zone ${zone})::date`;
    // No stored statement closes on or after the day: the cycle the card days would give, and never
    // one at or before the last stored statement (its closing date, possibly edited by hand, is
    // before the day, so the purchase belongs to a later cycle).
    const dayCycle = sql`to_char(case when extract(day from ${day}) <= ${creditCards.closingDay} then ${day} else ${day} + interval '1 month' end, 'YYYY-MM')`;
    const afterLastStored = sql`(
      select to_char((max(${creditCardStatements.period}) || '-01')::date + interval '1 month', 'YYYY-MM')
      from ${creditCardStatements}
      where ${creditCardStatements.cardId} = ${creditCards.id}
        and ${creditCardStatements.ownerId} = ${creditCards.ownerId}
    )`;
    const fallbackPeriod = sql`greatest(${dayCycle}, ${afterLastStored})`;
    // No purchase date bound: the statement places a purchase, and a purchase long before the first
    // stored cycle still belongs to that cycle, so the figure of a month must not depend on a range.
    const conditions = and(
      scopedTo(scope, { owner: movements.ownerId }),
      eq(movements.type, 'expense'),
      inArray(movements.categoryId, [...categoryIds]),
      // The payer movement of a group expense is counted through the payer's share instead.
      notExists(
        this.db
          .select({ one: sql`1` })
          .from(groupExpenses)
          .where(eq(groupExpenses.payerMovementId, movements.id)),
      ),
    );
    // Raw SQL because the statement lookup is a `left join lateral`, which the query builder cannot
    // express.
    const result = await this.db.execute<CardPurchaseSqlRow>(sql`
      select
        coalesce(stmt.period, ${fallbackPeriod}) as period,
        to_char(stmt.due_date, 'YYYY-MM-DD') as due_date,
        ${creditCards.closingDay} as closing_day,
        ${creditCards.dueDay} as due_day,
        ${movements.categoryId} as category_id,
        ${accounts.currency} as currency,
        ${movements.rate}::text as rate,
        sum(${movements.amount})::text as sum,
        count(*)::int as count
      from ${movements}
      inner join ${accounts}
        on ${accounts.id} = ${movements.accountId} and ${accounts.ownerId} = ${movements.ownerId}
      inner join ${creditCards}
        on ${creditCards.ownerId} = ${movements.ownerId}
        and (${creditCards.arsAccountId} = ${movements.accountId}
          or ${creditCards.usdAccountId} = ${movements.accountId})
      left join lateral (
        select ${creditCardStatements.period} as period, ${creditCardStatements.dueDate} as due_date
        from ${creditCardStatements}
        where ${creditCardStatements.cardId} = ${creditCards.id}
          and ${creditCardStatements.ownerId} = ${creditCards.ownerId}
          and ${creditCardStatements.closingDate} >= ${day}
        order by ${creditCardStatements.closingDate} asc, ${creditCardStatements.period} asc
        limit 1
      ) stmt on true
      where ${conditions}
      group by 1, 2, 3, 4, 5, 6, 7
    `);

    const months = dueMonthsOf(window);
    return result.rows
      .map((row) => {
        if (row.rate === null) throw new Error('A card purchase has no frozen rate');
        return {
          categoryId: row.category_id,
          currency: row.currency,
          rate: BigInt(row.rate),
          sum: BigInt(row.sum),
          count: row.count,
          period: row.period,
          dueDate: row.due_date,
          closingDay: row.closing_day,
          dueDay: row.due_day,
        };
      })
      .filter((row) => isDueWithin(row, months));
  }

  async installmentSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
  ): Promise<StatementInstallmentRow[]> {
    if (categoryIds.length === 0) return [];
    const months = dueMonthsOf(window);
    // A due date falls in its period's month or the next one; a stored one edited by hand may sit
    // further away, so the periods read are widened by 2 months on both sides, as the reports do, and
    // the exact due month is filtered below.
    const periodFrom = shiftMonth(months.first, -2);
    const periodTo = shiftMonth(months.last, 2);
    const rows = await this.db
      .select({
        period: installments.period,
        dueDate: creditCardStatements.dueDate,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        categoryId: installmentPurchases.categoryId,
        currency: installmentPurchases.currency,
        // Read as text and parsed with BigInt: a bigint sum must never pass through a number.
        sum: sql<string>`sum(${installments.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(installments)
      .innerJoin(
        installmentPurchases,
        and(
          eq(installmentPurchases.id, installments.purchaseId),
          eq(installmentPurchases.ownerId, installments.ownerId),
        ),
      )
      .innerJoin(
        creditCards,
        and(
          eq(creditCards.id, installmentPurchases.cardId),
          eq(creditCards.ownerId, installmentPurchases.ownerId),
        ),
      )
      .leftJoin(
        creditCardStatements,
        and(
          eq(creditCardStatements.cardId, installmentPurchases.cardId),
          eq(creditCardStatements.ownerId, installmentPurchases.ownerId),
          eq(creditCardStatements.period, installments.period),
        ),
      )
      .where(
        and(
          scopedTo(scope, { owner: installments.ownerId }),
          inArray(installmentPurchases.categoryId, [...categoryIds]),
          gte(installments.period, periodFrom),
          lte(installments.period, periodTo),
        ),
      )
      .groupBy(
        installments.period,
        creditCardStatements.dueDate,
        creditCards.closingDay,
        creditCards.dueDay,
        installmentPurchases.categoryId,
        installmentPurchases.currency,
      )
      .orderBy(asc(installments.period), asc(installmentPurchases.categoryId));

    return rows
      .map((row) => ({
        categoryId: row.categoryId,
        currency: row.currency,
        sum: BigInt(row.sum),
        count: row.count,
        period: row.period,
        dueDate: row.dueDate,
        closingDay: row.closingDay,
        dueDay: row.dueDay,
      }))
      .filter((row) => isDueWithin(row, months));
  }

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
          // An expense on a card's linked account is read by its statement instead (FEAT-011), so a
          // card purchase is never counted in two months.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(creditCards)
              .where(
                and(
                  eq(creditCards.ownerId, movements.ownerId),
                  or(
                    eq(creditCards.arsAccountId, movements.accountId),
                    eq(creditCards.usdAccountId, movements.accountId),
                  ),
                ),
              ),
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
