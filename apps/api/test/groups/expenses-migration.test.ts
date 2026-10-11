import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0027_group_expenses';
const PREVIOUS_WHEN = 1791661150964;
const ADDED_TABLES = [
  'group_activity_log',
  'group_default_split_shares',
  'group_expense_shares',
  'group_expenses',
];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_group_expenses_migration_test`;
  return url.toString();
})();

const HOOK_TIMEOUT_MS = 30_000;

let client: pg.Client;

async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

beforeAll(async () => {
  await ensureTestDatabase(throwawayUrl);
  client = new pg.Client({ connectionString: throwawayUrl });
  await client.connect();
  await emptyTheDatabase(client);
  await runMigrations(throwawayUrl);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

const fileOf = (relative: string) => readFile(`${migrationsFolder}/${relative}`, 'utf8');

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function addedTables(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1) order by table_name`,
    [ADDED_TABLES],
  );
  return result.rows.map((row) => row.table_name);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function hasDefaultSplitModeColumn(): Promise<boolean> {
  const result = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'groups' and column_name = 'default_split_mode'`,
  );
  return result.rowCount === 1;
}

async function sqlState(statement: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function one(statement: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(statement, values);
  return result.rows[0]?.id ?? '';
}

const createGroup = () =>
  one("insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id");

const createGhost = (group: string, name = 'Pedro') =>
  one('insert into group_members (group_id, display_name) values ($1, $2) returning id', [
    group,
    name,
  ]);

const createCategory = (group: string) =>
  one(
    `insert into group_categories (group_id, default_key, icon, color)
     values ($1, 'food', 'utensils', 'red') returning id`,
    [group],
  );

interface Fixture {
  group: string;
  member: string;
  category: string;
}

async function fixture(): Promise<Fixture> {
  const group = await createGroup();
  return { group, member: await createGhost(group), category: await createCategory(group) };
}

const insertExpense = (
  f: Fixture,
  overrides: { amount?: string; payer?: string; movement?: string | null; id?: string } = {},
) =>
  sqlState(
    `insert into group_expenses
       (id, group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
        category_id, description, split_mode, payer_movement_id)
     values ($1, $2, $3, $3, $4, 'ARS', now(), $5, 'Dinner', 'equal', $6)`,
    [
      overrides.id ?? randomUUID(),
      f.group,
      overrides.payer ?? f.member,
      overrides.amount ?? '1000',
      f.category,
      overrides.movement ?? null,
    ],
  );

describe('0027_group_expenses migration', () => {
  it('applies on an empty database and creates the four tables and the column (NFR-01)', async () => {
    expect(await addedTables()).toEqual(ADDED_TABLES);
    expect(await hasDefaultSplitModeColumn()).toBe(true);
  });

  it('is reverted by its rollback, which runs twice, touching only what it added, and re-applies', async () => {
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    // 0030, 0029 and 0028 have the greater journal `when`s and hang from the same members: they go first.
    await client.query(await fileOf('rollback/0030_group_activity_log_changes.down.sql'));
    await client.query(await fileOf('rollback/0029_card_automatic_debit.down.sql'));
    await client.query(await fileOf('rollback/0028_group_settlements.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await addedTables()).toEqual([]);
    expect(await hasDefaultSplitModeColumn()).toBe(false);
    expect(await publicTableCount()).toBe(tablesBefore - ADDED_TABLES.length - 3);
    expect(await appliedMigrations()).toBe(countBefore - 4);
    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await addedTables()).toEqual(ADDED_TABLES);
    expect(await hasDefaultSplitModeColumn()).toBe(true);
  });

  it('refuses a zero or negative expense amount and accepts a positive one (AC-02)', async () => {
    const f = await fixture();

    expect(await insertExpense(f, { amount: '0' })).toBe('23514');
    expect(await insertExpense(f, { amount: '-5' })).toBe('23514');
    expect(await insertExpense(f, { amount: '1' })).toBeUndefined();
  });

  it('refuses a share whose member belongs to another group (AC-03)', async () => {
    const f = await fixture();
    const other = await fixture();
    const expense = randomUUID();
    expect(await insertExpense(f, { id: expense })).toBeUndefined();

    const insertShare = (member: string, group: string) =>
      sqlState(
        `insert into group_expense_shares (expense_id, member_id, group_id, amount)
         values ($1, $2, $3, 500)`,
        [expense, member, group],
      );

    expect(await insertShare(other.member, f.group)).toBe('23503');
    expect(await insertShare(other.member, other.group)).toBe('23503');
    expect(await insertShare(f.member, f.group)).toBeUndefined();
  });

  it('refuses an expense whose payer belongs to another group', async () => {
    const f = await fixture();
    const other = await fixture();

    expect(await insertExpense(f, { payer: other.member })).toBe('23503');
  });

  it('sets payer_movement_id to null when the movement is deleted and keeps the expense (AC-14)', async () => {
    const f = await fixture();
    const user = await one(
      `insert into users (email, password_hash, time_zone, language)
       values ('payer@expenses.test', 'h', 'UTC', 'es') returning id`,
    );
    const account = await one(
      `insert into accounts (owner_id, name, currency, type, opening_balance, include_in_available)
       values ($1, 'Cash', 'ARS', 'cash', 0, true) returning id`,
      [user],
    );
    const category = await one(
      `insert into categories (owner_id, kind, default_key, icon, color)
       values ($1, 'expense', 'food', 'utensils', 'red') returning id`,
      [user],
    );
    const movement = await one(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 1000, now(), 10000, 'manual') returning id`,
      [user, account, category],
    );
    const expense = randomUUID();
    expect(await insertExpense(f, { id: expense, movement })).toBeUndefined();

    await client.query('delete from movements where id = $1', [movement]);

    const row = await client.query<{ payer_movement_id: string | null }>(
      'select payer_movement_id from group_expenses where id = $1',
      [expense],
    );
    expect(row.rows).toEqual([{ payer_movement_id: null }]);
  });

  it('rejects a duplicate share row and a share for a missing member as database errors', async () => {
    const f = await fixture();
    const expense = randomUUID();
    await insertExpense(f, { id: expense });
    const insertShare = (member: string) =>
      sqlState(
        `insert into group_expense_shares (expense_id, member_id, group_id, amount)
         values ($1, $2, $3, 100)`,
        [expense, member, f.group],
      );

    expect(await insertShare(f.member)).toBeUndefined();
    expect(await insertShare(f.member)).toBe('23505');
    expect(await insertShare(randomUUID())).toBe('23503');
  });

  it('bounds shares, basis points, split mode and description with checks', async () => {
    const f = await fixture();
    const expense = randomUUID();
    await insertExpense(f, { id: expense });
    const insertShare = (amount: number, basisPoints: number | null) =>
      sqlState(
        `insert into group_expense_shares (expense_id, member_id, group_id, amount, basis_points)
         values ($1, $2, $3, $4, $5)`,
        [expense, f.member, f.group, amount, basisPoints],
      );

    expect(await insertShare(-1, null)).toBe('23514');
    expect(await insertShare(0, 10_001)).toBe('23514');
    expect(await insertShare(0, -1)).toBe('23514');
    expect(await insertShare(0, 10_000)).toBeUndefined();

    const insertDescription = (description: string, mode = 'equal') =>
      sqlState(
        `insert into group_expenses
           (group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
            category_id, description, split_mode)
         values ($1, $2, $2, 100, 'USD', now(), $3, $4, $5)`,
        [f.group, f.member, f.category, description, mode],
      );
    expect(await insertDescription('')).toBe('23514');
    expect(await insertDescription('x'.repeat(201))).toBe('23514');
    expect(await insertDescription('ok', 'weights')).toBe('23514');
    expect(await insertDescription('x'.repeat(200), 'exact')).toBeUndefined();
  });

  it('refuses an unknown default split mode and an unknown log action', async () => {
    const f = await fixture();

    expect(
      await sqlState("update groups set default_split_mode = 'exact' where id = $1", [f.group]),
    ).toBe('23514');
    expect(
      await sqlState("update groups set default_split_mode = 'percentage' where id = $1", [
        f.group,
      ]),
    ).toBeUndefined();
    expect(
      await sqlState(
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         values ($1, $2, 'expense_deleted', $3, now())`,
        [f.group, f.member, randomUUID()],
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         values ($1, $2, 'expense_created', $3, now())`,
        [f.group, f.member, randomUUID()],
      ),
    ).toBeUndefined();
  });

  it('cascades an expense to its shares and a group to its default split, and keeps members with expenses (AC-03)', async () => {
    const f = await fixture();
    const expense = randomUUID();
    await insertExpense(f, { id: expense });
    await client.query(
      `insert into group_expense_shares (expense_id, member_id, group_id, amount)
       values ($1, $2, $3, 1000)`,
      [expense, f.member, f.group],
    );
    await client.query(
      `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
       values ($1, $2, 'expense_created', $3, now())`,
      [f.group, f.member, expense],
    );

    expect(await sqlState('delete from group_members where id = $1', [f.member])).toBe('23503');

    await client.query('delete from group_expenses where id = $1', [expense]);
    const shares = await client.query('select 1 from group_expense_shares where expense_id = $1', [
      expense,
    ]);
    expect(shares.rowCount).toBe(0);

    const empty = await fixture();
    await client.query(
      'insert into group_default_split_shares (group_id, member_id, basis_points) values ($1, $2, 10000)',
      [empty.group, empty.member],
    );
    await client.query('delete from groups where id = $1', [empty.group]);
    const left = await client.query(
      'select 1 from group_default_split_shares where group_id = $1',
      [empty.group],
    );
    expect(left.rowCount).toBe(0);
  });

  it('has the journal entry at idx 27 with a when above 0026, and chains its snapshot onto 0026', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(27);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0027_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0026_snapshot.json')).id,
    );
  });
});
