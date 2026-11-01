import { databaseTimeZone } from '@pesly/shared';
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  CardPurchaseItemRow,
  CategoryItemReader,
  InstallmentItemRow,
  PersonalItemRow,
  ShareItemRow,
} from '../../application/ports/category-item-reader';
import type { FlowWindow } from '../../application/ports/flow-reader';
import { cardPurchaseSource } from './card-purchase-source';
import { instant, ownedFlowConditions, personalConditions } from './flow-conditions';
import {
  accounts,
  categories,
  creditCardStatements,
  creditCards,
  groupCategories,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
  groups,
  installmentPurchases,
  installments,
  movements,
} from './foreign-relations';

const dayIn = (column: AnyPgColumn, timeZone: string) =>
  sql<string>`to_char(${column} at time zone ${databaseTimeZone(timeZone)}, 'YYYY-MM-DD')`;

const topOf = sql`coalesce(${categories.parentId}, ${categories.id})`;

interface CardPurchaseItemSqlRow extends Record<string, unknown> {
  movement_id: string;
  day: string;
  note: string | null;
  category_id: string;
  category_name: string | null;
  category_default_key: string | null;
  card_id: string;
  period: string;
  due_date: string | null;
  closing_day: number;
  due_day: number;
  top_category_id: string;
  currency: 'ARS' | 'USD';
  rate: string | null;
  amount: string;
}

/** The reads of `DrizzleFlowReader`, one item per row and narrowed to one category. */
export class DrizzleCategoryItemReader implements CategoryItemReader {
  constructor(private readonly db: Database) {}

  async personalItems(
    scope: AccessScope,
    window: FlowWindow,
    topCategoryId: string,
  ): Promise<PersonalItemRow[]> {
    const rows = await this.db
      .select({
        movementId: movements.id,
        day: dayIn(movements.occurredAt, window.timeZone),
        note: movements.note,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryDefaultKey: categories.defaultKey,
        currency: accounts.currency,
        rate: movements.rate,
        amount: movements.amount,
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
      .where(
        and(
          personalConditions(this.db, scope, window),
          eq(movements.type, 'expense'),
          sql`${topOf} = ${topCategoryId}`,
        ),
      )
      .orderBy(desc(movements.occurredAt), desc(movements.id));

    return rows.map((row) => {
      if (row.rate === null) throw new Error('A flow movement has no frozen rate');
      return {
        movementId: row.movementId,
        day: row.day,
        note: row.note,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        categoryDefaultKey: row.categoryDefaultKey,
        type: 'expense',
        topCategoryId,
        currency: row.currency,
        rate: row.rate,
        sum: row.amount,
        count: 1,
      };
    });
  }

  async cardPurchaseItems(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
    options: { timeZone: string; topCategoryId: string },
  ): Promise<CardPurchaseItemRow[]> {
    const source = cardPurchaseSource(options.timeZone);
    const conditions = and(
      ...ownedFlowConditions(this.db, scope, {}),
      eq(movements.type, 'expense'),
      sql`${topOf} = ${options.topCategoryId}`,
    );
    const result = await this.db.execute<CardPurchaseItemSqlRow>(sql`
      select * from (
        select
          ${movements.id} as movement_id,
          ${source.day} as day,
          ${movements.note} as note,
          ${categories.id} as category_id,
          ${categories.name} as category_name,
          ${categories.defaultKey} as category_default_key,
          ${creditCards.id} as card_id,
          ${source.period} as period,
          ${source.dueDate} as due_date,
          ${creditCards.closingDay} as closing_day,
          ${creditCards.dueDay} as due_day,
          ${topOf} as top_category_id,
          ${accounts.currency} as currency,
          ${movements.rate}::text as rate,
          ${movements.amount}::text as amount,
          ${movements.occurredAt} as occurred_at
        from ${source.from}
        where ${conditions}
      ) items
      where items.period between ${periodFrom} and ${periodTo}
      order by items.occurred_at desc, items.movement_id desc
    `);

    return result.rows.map((row) => {
      if (row.rate === null) throw new Error('A flow movement has no frozen rate');
      return {
        movementId: row.movement_id,
        day: row.day,
        note: row.note,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categoryDefaultKey: row.category_default_key,
        cardId: row.card_id,
        period: row.period,
        dueDate: row.due_date,
        closingDay: row.closing_day,
        dueDay: row.due_day,
        topCategoryId: row.top_category_id,
        currency: row.currency,
        rate: BigInt(row.rate),
        sum: BigInt(row.amount),
        count: 1,
      };
    });
  }

  async installmentItems(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
    topCategoryId: string,
  ): Promise<InstallmentItemRow[]> {
    const rows = await this.db
      .select({
        purchaseId: installmentPurchases.id,
        cardId: installmentPurchases.cardId,
        number: installments.number,
        installmentCount: installmentPurchases.installmentCount,
        day: sql<string>`to_char(${installmentPurchases.purchasedOn}, 'YYYY-MM-DD')`,
        note: installmentPurchases.note,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryDefaultKey: categories.defaultKey,
        period: installments.period,
        dueDate: sql<string | null>`to_char(${creditCardStatements.dueDate}, 'YYYY-MM-DD')`,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        currency: installmentPurchases.currency,
        amount: installments.amount,
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
          sql`${topOf} = ${topCategoryId}`,
        ),
      )
      .orderBy(desc(installmentPurchases.purchasedOn), desc(installments.number));

    return rows.map((row) => ({
      ...row,
      topCategoryId,
      rate: null,
      sum: row.amount,
      count: 1,
    }));
  }

  async shareItems(scope: AccessScope, window: FlowWindow): Promise<ShareItemRow[]> {
    assertIssuedScope(scope);
    // The same reach as `DrizzleFlowReader.shareRows`: only through the caller's member rows.
    const rows = await this.db
      .select({
        expenseId: groupExpenses.id,
        groupId: groups.id,
        groupName: groups.name,
        day: dayIn(groupExpenses.occurredAt, window.timeZone),
        month: sql<string>`to_char(${groupExpenses.occurredAt} at time zone ${databaseTimeZone(window.timeZone)}, 'YYYY-MM')`,
        description: groupExpenses.description,
        groupCategoryId: groupCategories.id,
        categoryName: groupCategories.name,
        categoryDefaultKey: groupCategories.defaultKey,
        currency: groupExpenses.currency,
        rate: movements.rate,
        amount: groupExpenseShares.amount,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
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
      .orderBy(desc(groupExpenses.occurredAt), desc(groupExpenses.id));

    return rows.map(({ amount, ...row }) => ({ ...row, sum: amount, count: 1 }));
  }
}
