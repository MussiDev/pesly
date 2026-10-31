import { and, asc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  CardPurchaseFlowRow,
  CardPurchaseOptions,
  FlowReader,
  FlowWindow,
  InstallmentFlowRow,
  PersonalFlowRow,
  ShareFlowRow,
} from '../../application/ports/flow-reader';
import type { TopCategory } from '../../domain/flows';
import { cardPurchaseSource } from './card-purchase-source';
import { instant, monthIn, ownedFlowConditions, personalConditions } from './flow-conditions';
import {
  accounts,
  categories,
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
  top_category_id: string | null;
  currency: 'ARS' | 'USD';
  rate: string | null;
  sum: string;
  count: number;
}

export class DrizzleFlowReader implements FlowReader {
  constructor(private readonly db: Database) {}

  async personalRows(scope: AccessScope, window: FlowWindow): Promise<PersonalFlowRow[]> {
    const rows = await this.db
      .select({
        month: monthIn(movements.occurredAt, window.timeZone),
        type: movements.type,
        topCategoryId: sql<string | null>`coalesce(${categories.parentId}, ${categories.id})`,
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
      .innerJoin(
        categories,
        and(eq(categories.id, movements.categoryId), eq(categories.ownerId, movements.ownerId)),
      )
      .where(personalConditions(this.db, scope, window))
      // Ordinals: the month expression carries a bound zone, so it cannot be repeated here.
      .groupBy(sql.raw('1, 2, 3, 4, 5'))
      .orderBy(sql.raw('1, 2, 3, 4, 5'));

    return rows.map((row) => {
      if (row.topCategoryId === null) throw new Error('A flow movement has no category');
      if (row.rate === null) throw new Error('A flow movement has no frozen rate');
      if (row.type !== 'expense' && row.type !== 'income') {
        throw new Error('A flow row is neither an expense nor an income');
      }
      return {
        month: row.month,
        type: row.type,
        topCategoryId: row.topCategoryId,
        currency: row.currency,
        rate: row.rate,
        sum: BigInt(row.sum),
        count: row.count,
      };
    });
  }

  async shareRows(scope: AccessScope, window: FlowWindow): Promise<ShareFlowRow[]> {
    assertIssuedScope(scope);
    // The same rule as the budgets (06c): the group tables are reached only through the caller's
    // member rows, and the rate is the one of the caller's own payer movement.
    const rows = await this.db
      .select({
        month: monthIn(groupExpenses.occurredAt, window.timeZone),
        categoryName: groupCategories.name,
        categoryDefaultKey: groupCategories.defaultKey,
        currency: groupExpenses.currency,
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
          gte(groupExpenses.occurredAt, instant(window.from)),
          lt(groupExpenses.occurredAt, instant(window.before)),
        ),
      )
      .groupBy(sql.raw('1, 2, 3, 4, 5'), groupCategories.id)
      .orderBy(sql.raw('1, 2, 3, 4, 5'));

    return rows.map((row) => ({
      month: row.month,
      categoryName: row.categoryName,
      categoryDefaultKey: row.categoryDefaultKey,
      currency: row.currency,
      rate: row.rate,
      sum: BigInt(row.sum),
      count: row.count,
    }));
  }

  async installmentRows(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
  ): Promise<InstallmentFlowRow[]> {
    const rows = await this.db
      .select({
        period: installments.period,
        dueDate: creditCardStatements.dueDate,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        topCategoryId: sql<string>`coalesce(${categories.parentId}, ${categories.id})`,
        currency: installmentPurchases.currency,
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
      .innerJoin(
        categories,
        and(
          eq(categories.id, installmentPurchases.categoryId),
          eq(categories.ownerId, installmentPurchases.ownerId),
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
          gte(installments.period, periodFrom),
          lte(installments.period, periodTo),
        ),
      )
      .groupBy(
        installments.period,
        creditCardStatements.dueDate,
        creditCards.closingDay,
        creditCards.dueDay,
        categories.id,
        installmentPurchases.currency,
      )
      .orderBy(
        asc(installments.period),
        asc(categories.id),
        asc(installmentPurchases.currency),
        asc(creditCards.closingDay),
        asc(creditCards.dueDay),
      );

    return rows.map((row) => ({
      period: row.period,
      dueDate: row.dueDate,
      closingDay: row.closingDay,
      dueDay: row.dueDay,
      topCategoryId: row.topCategoryId,
      currency: row.currency,
      rate: null,
      sum: BigInt(row.sum),
      count: row.count,
    }));
  }

  async cardPurchaseRows(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
    options: CardPurchaseOptions,
  ): Promise<CardPurchaseFlowRow[]> {
    const source = cardPurchaseSource(options.timeZone);
    const conditions = and(
      ...ownedFlowConditions(this.db, scope, options),
      eq(movements.type, 'expense'),
    );
    // One grouped read, then the exact period filter on the outside: the period is a computed
    // column, so filtering it in HAVING would repeat the expression under other placeholders.
    const result = await this.db.execute<CardPurchaseSqlRow>(sql`
      select * from (
        select
          ${source.period} as period,
          ${source.dueDate} as due_date,
          ${creditCards.closingDay} as closing_day,
          ${creditCards.dueDay} as due_day,
          coalesce(${categories.parentId}, ${categories.id}) as top_category_id,
          ${accounts.currency} as currency,
          ${movements.rate}::text as rate,
          sum(${movements.amount})::text as sum,
          count(*)::int as count
        from ${source.from}
        where ${conditions}
        group by 1, 2, 3, 4, 5, 6, 7
      ) grouped
      where grouped.period between ${periodFrom} and ${periodTo}
      order by grouped.period, grouped.top_category_id, grouped.currency, grouped.rate
    `);

    return result.rows.map((row) => {
      if (row.top_category_id === null) throw new Error('A flow movement has no category');
      if (row.rate === null) throw new Error('A flow movement has no frozen rate');
      return {
        period: row.period,
        dueDate: row.due_date,
        closingDay: row.closing_day,
        dueDay: row.due_day,
        topCategoryId: row.top_category_id,
        currency: row.currency,
        rate: BigInt(row.rate),
        sum: BigInt(row.sum),
        count: row.count,
      };
    });
  }

  async topCategories(scope: AccessScope): Promise<TopCategory[]> {
    const parents = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        defaultKey: categories.defaultKey,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(
        and(
          scopedTo(scope, { owner: categories.ownerId }),
          eq(categories.kind, 'expense'),
          isNull(categories.parentId),
        ),
      )
      .orderBy(asc(categories.createdAt), asc(categories.id));

    const child = alias(categories, 'child');
    const children = await this.db
      .select({ parentId: child.parentId, name: child.name, defaultKey: child.defaultKey })
      .from(child)
      .where(and(scopedTo(scope, { owner: child.ownerId }), eq(child.kind, 'expense')));

    const namesByParent = new Map<string, { name: string | null; defaultKey: string | null }[]>();
    for (const row of children) {
      if (row.parentId === null) continue;
      const list = namesByParent.get(row.parentId) ?? [];
      list.push({ name: row.name, defaultKey: row.defaultKey });
      namesByParent.set(row.parentId, list);
    }
    return parents.map((parent) => ({
      ...parent,
      children: namesByParent.get(parent.id) ?? [],
    }));
  }
}
