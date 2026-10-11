import { randomUUID } from 'node:crypto';
import { DEFAULT_CATEGORIES, type AccountCurrency } from '@pesly/shared';
import type pg from 'pg';
import type { NewGroupSettlement } from '../../src/groups';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import type { Database } from '../../src/shared/db/client';
import { newUserId } from '../movements/db-fixtures';

export const NOW = new Date('2026-10-10T12:00:00.000Z');
export const HOUR = 60 * 60 * 1000;

export interface DbWorld {
  userId: string;
  groupId: string;
  /** The creator (admin, registered). */
  anaMember: string;
  /** Every member id, `anaMember` first. */
  memberIds: string[];
  categoryId: string;
}

/** A group whose creator is a registered user and whose other members are ghosts (bulk insert). */
export async function newDbWorld(
  db: Database,
  pool: pg.Pool,
  options: { ghosts: number },
): Promise<DbWorld> {
  const userId = await newUserId(db);
  const { group } = await new DrizzleGroupRepository(db).create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: userId,
    categories: DEFAULT_CATEGORIES.filter((c) => c.parentKey === null && c.kind === 'expense')
      .slice(0, 1)
      .map((c) => ({ defaultKey: c.key, name: null, icon: c.icon, color: c.color })),
  });
  const members = await pool.query<{ id: string }>(
    'select id from group_members where group_id = $1',
    [group.id],
  );
  const anaMember = members.rows[0]?.id ?? '';
  const ghosts = await pool.query<{ id: string }>(
    `insert into group_members (group_id, display_name)
     select $1, 'Ghost ' || g from generate_series(1, $2::int) g returning id`,
    [group.id, options.ghosts],
  );
  const category = await pool.query<{ id: string }>(
    'select id from group_categories where group_id = $1 limit 1',
    [group.id],
  );
  return {
    userId,
    groupId: group.id,
    anaMember,
    memberIds: [anaMember, ...ghosts.rows.map((row) => row.id)],
    categoryId: category.rows[0]?.id ?? '',
  };
}

export interface SqlExpense {
  payer: string;
  amount: bigint;
  currency: AccountCurrency;
  /** Shares must add up to `amount`. */
  shares: { memberId: string; amount: bigint }[];
  occurredAt?: Date;
}

/** Bulk insert with unnest; no use case, no log row, no payer movement. */
export async function insertExpensesSql(
  pool: pg.Pool | pg.PoolClient,
  w: DbWorld,
  expenses: readonly SqlExpense[],
): Promise<void> {
  if (expenses.length === 0) return;
  const ids = expenses.map(() => randomUUID());
  await pool.query(
    `insert into group_expenses
       (id, group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
        category_id, description, split_mode)
     select id, $2::uuid, payer, $3::uuid, amount::bigint, currency, occurred_at, $4::uuid,
       'Seed', 'exact'
     from unnest($1::uuid[], $5::uuid[], $6::text[], $7::text[], $8::timestamptz[])
       as t(id, payer, amount, currency, occurred_at)`,
    [
      ids,
      w.groupId,
      w.anaMember,
      w.categoryId,
      expenses.map((e) => e.payer),
      expenses.map((e) => e.amount.toString()),
      expenses.map((e) => e.currency),
      expenses.map((e) => (e.occurredAt ?? new Date(NOW.getTime() - HOUR)).toISOString()),
    ],
  );
  const shareExpenseIds: string[] = [];
  const shareMembers: string[] = [];
  const shareAmounts: string[] = [];
  expenses.forEach((expense, index) => {
    for (const share of expense.shares) {
      shareExpenseIds.push(ids[index] ?? '');
      shareMembers.push(share.memberId);
      shareAmounts.push(share.amount.toString());
    }
  });
  await pool.query(
    `insert into group_expense_shares (expense_id, member_id, group_id, amount)
     select e, m, $1::uuid, a::bigint from unnest($2::uuid[], $3::uuid[], $4::text[]) as t(e, m, a)`,
    [w.groupId, shareExpenseIds, shareMembers, shareAmounts],
  );
}

/** Equal split with the leftover going to the first members. */
export function equalSplit(
  amount: bigint,
  memberIds: readonly string[],
): { memberId: string; amount: bigint }[] {
  const each = amount / BigInt(memberIds.length);
  let leftover = amount - each * BigInt(memberIds.length);
  return memberIds.map((memberId) => {
    const extra = leftover > 0n ? 1n : 0n;
    leftover -= extra;
    return { memberId, amount: each + extra };
  });
}

export function plainSettlement(
  w: DbWorld,
  overrides: Partial<NewGroupSettlement> = {},
): NewGroupSettlement {
  const currency = overrides.currency ?? 'ARS';
  const amount = overrides.amount ?? 3_000_000n;
  return {
    groupId: w.groupId,
    fromMemberId: w.memberIds[1] ?? '',
    toMemberId: w.anaMember,
    currency,
    amount,
    legs: [{ currency, amount }],
    occurredAt: new Date(NOW.getTime() - HOUR),
    createdByMemberId: w.anaMember,
    account: null,
    rate: null,
    consolidation: null,
    activity: { action: 'settlement_created', memberId: w.anaMember, createdAt: NOW },
    ...overrides,
  };
}

/** Deterministic PRNG (mulberry32) for the seeded tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
