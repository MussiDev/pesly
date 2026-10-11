import { DEFAULT_CATEGORIES, type AccountCurrency } from '@pesly/shared';
import type pg from 'pg';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import type { Database } from '../../src/shared/db/client';
import { newUserId } from '../movements/db-fixtures';
import type { DbWorld } from './settlement-db-world';

export interface RemovalWorld extends DbWorld {
  /** Registered users behind the members. */
  anaUser: string;
  beaUser: string;
  /** Registered, non-admin member. */
  beaMember: string;
  /** Ghost member. */
  ghostMember: string;
}

/** A group with an admin (Ana), a registered member (Bea) and a ghost, plus one category. */
export async function newRemovalWorld(db: Database, pool: pg.Pool): Promise<RemovalWorld> {
  const anaUser = await newUserId(db);
  const beaUser = await newUserId(db);
  const repository = new DrizzleGroupRepository(db);
  const { group } = await repository.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: anaUser,
    categories: DEFAULT_CATEGORIES.filter((c) => c.parentKey === null && c.kind === 'expense')
      .slice(0, 1)
      .map((c) => ({ defaultKey: c.key, name: null, icon: c.icon, color: c.color })),
  });
  const ana = await repository.findMember(group.id, anaUser);
  const bea = await pool.query<{ id: string }>(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group.id, beaUser],
  );
  const ghost = await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });
  const category = await repository.listCategories(group.id);
  const anaMember = ana?.id ?? '';
  const beaMember = bea.rows[0]?.id ?? '';
  return {
    userId: anaUser,
    anaUser,
    beaUser,
    groupId: group.id,
    anaMember,
    beaMember,
    ghostMember: ghost.id,
    memberIds: [anaMember, beaMember, ghost.id],
    categoryId: category[0]?.id ?? '',
  };
}

/** Direct SQL: a settlement of `amount` from `from` to `to` clearing one leg in `currency`. */
export async function insertSettlementSql(
  pool: pg.Pool,
  w: DbWorld,
  data: { from: string; to: string; currency: AccountCurrency; amount: bigint },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into group_settlements
       (group_id, from_member_id, to_member_id, created_by_member_id, currency, amount, occurred_at)
     values ($1, $2, $3, $4, $5, $6::bigint, now()) returning id`,
    [w.groupId, data.from, data.to, w.anaMember, data.currency, data.amount.toString()],
  );
  const id = result.rows[0]?.id ?? '';
  await pool.query(
    `insert into group_settlement_legs (settlement_id, group_id, currency, amount)
     values ($1, $2, $3, $4::bigint)`,
    [id, w.groupId, data.currency, data.amount.toString()],
  );
  return id;
}

/** Independent of the adapter's helper: the balance of one member as exact signed strings. */
export async function sqlBalance(
  pool: pg.Pool,
  groupId: string,
  memberId: string,
  currency: AccountCurrency,
): Promise<bigint> {
  const result = await pool.query<{ balance: string }>(
    `select (
       coalesce((select sum(amount) from group_expenses
                 where group_id = $1 and payer_member_id = $2 and currency = $3), 0)
       - coalesce((select sum(s.amount) from group_expense_shares s
                   join group_expenses e on e.id = s.expense_id
                   where s.group_id = $1 and s.member_id = $2 and e.currency = $3), 0)
       + coalesce((select sum(l.amount) from group_settlement_legs l
                   join group_settlements t on t.id = l.settlement_id
                   where l.group_id = $1 and l.currency = $3 and t.from_member_id = $2), 0)
       - coalesce((select sum(l.amount) from group_settlement_legs l
                   join group_settlements t on t.id = l.settlement_id
                   where l.group_id = $1 and l.currency = $3 and t.to_member_id = $2), 0)
     )::text as balance`,
    [groupId, memberId, currency],
  );
  return BigInt(result.rows[0]?.balance ?? '0');
}
