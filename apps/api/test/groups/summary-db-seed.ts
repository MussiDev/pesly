import { randomUUID } from 'node:crypto';
import type { AccountCurrency } from '@pesly/shared';
import type pg from 'pg';
import type { DbWorld } from './settlement-db-world';

export interface SeedExpense {
  currency: AccountCurrency;
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
}

export async function addCategory(pool: pg.Pool, groupId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into group_categories (group_id, name, icon, color) values ($1, $2, 'home', 'blue') returning id`,
    [groupId, name],
  );
  return result.rows[0]?.id ?? '';
}

export async function seedExpenses(
  pool: pg.Pool,
  w: DbWorld,
  expenses: readonly SeedExpense[],
): Promise<void> {
  if (expenses.length === 0) return;
  await pool.query(
    `insert into group_expenses
       (id, group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
        category_id, description, split_mode)
     select id, $2::uuid, $3::uuid, $3::uuid, amount::bigint, currency, occurred_at, category,
       'Seed', 'exact'
     from unnest($1::uuid[], $4::text[], $5::text[], $6::timestamptz[], $7::uuid[])
       as t(id, amount, currency, occurred_at, category)`,
    [
      expenses.map(() => randomUUID()),
      w.groupId,
      w.anaMember,
      expenses.map((e) => e.amount.toString()),
      expenses.map((e) => e.currency),
      expenses.map((e) => e.occurredAt.toISOString()),
      expenses.map((e) => e.categoryId),
    ],
  );
}
