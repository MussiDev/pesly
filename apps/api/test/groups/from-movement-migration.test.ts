import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0037_group_expense_from_movement';
const WHEN = 1791810000000;
const MAIN_MAX_WHEN = 1791800000000;
const UNIQUE_INDEX = 'group_expenses_payer_movement_unique';
const PLAIN_INDEX = 'group_expenses_payer_movement_idx';

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_from_movement_migration_test`;
  return url.toString();
})();

const HOOK_TIMEOUT_MS = 60_000;

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

async function appliedWhens(): Promise<number[]> {
  const result = await client.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations order by created_at',
  );
  return result.rows.map((row) => Number(row.created_at));
}

async function indexDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
    ['public', name],
  );
  return result.rows[0]?.indexdef;
}

async function columnInfo(table: string, column: string) {
  const result = await client.query<{
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return result.rows[0];
}

async function checkDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ def: string }>(
    'select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1',
    [name],
  );
  return result.rows[0]?.def;
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

interface World {
  group: string;
  member: string;
  category: string;
  user: string;
  account: string;
}

async function world(): Promise<World> {
  const group = await one(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  const user = await one(
    `insert into users (email, password_hash, time_zone, language)
     values ($1, 'h', 'UTC', 'es') returning id`,
    [`${randomUUID()}@from-movement.test`],
  );
  const member = await one(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group, user],
  );
  const category = await one(
    `insert into group_categories (group_id, name, icon, color)
     values ($1, 'Food', 'wallet', 'blue') returning id`,
    [group],
  );
  const account = await one(
    `insert into accounts (owner_id, name, currency, type, opening_balance, include_in_available)
     values ($1, 'Cash', 'ARS', 'cash', 0, true) returning id`,
    [user],
  );
  return { group, member, category, user, account };
}

async function movement(w: World): Promise<string> {
  const owner = await one(
    `insert into categories (owner_id, kind, name, icon, color)
     values ($1, 'expense', $2, 'wallet', 'blue') returning id`,
    [w.user, randomUUID()],
  );
  return one(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at,
       rate, rate_source)
     values ($1, 'expense', $2, $3, 1000, now(), 10000, 'manual') returning id`,
    [w.user, w.account, owner],
  );
}

const insertExpense = (w: World, movementId: string | null, adopted?: boolean) =>
  sqlState(
    `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
       occurred_at, category_id, description, split_mode, payer_movement_id ${
         adopted === undefined ? '' : ', adopted_movement'
       })
     values ($1, $2, $2, 1000, 'ARS', now(), $3, 'Dinner', 'equal', $4 ${
       adopted === undefined ? '' : ', $5'
     })`,
    adopted === undefined
      ? [w.group, w.member, w.category, movementId]
      : [w.group, w.member, w.category, movementId, adopted],
  );

const insertLog = (
  w: World,
  action: string,
  fromMovement: boolean,
  autoCategory: string | null,
): Promise<string | undefined> => {
  const snapshots = action === 'expense_updated' ? "'{}'::jsonb, '{}'::jsonb" : 'null, null';
  return sqlState(
    `insert into group_activity_log (group_id, member_id, action, subject_id, created_at,
       before, after, from_movement, auto_category)
     values ($1, $2, $3, $4, now(), ${snapshots}, $5, $6)`,
    [w.group, w.member, action, randomUUID(), fromMovement, autoCategory],
  );
};

describe('0037_group_expense_from_movement migration', () => {
  it('applies on an empty database and adds the columns, checks and unique index', async () => {
    expect(await columnInfo('group_expenses', 'adopted_movement')).toEqual({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    });
    expect(await columnInfo('group_activity_log', 'from_movement')).toEqual({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    });
    expect(await columnInfo('group_activity_log', 'auto_category')).toEqual({
      data_type: 'text',
      is_nullable: 'YES',
      column_default: null,
    });
    expect(await checkDefinition('group_activity_log_from_movement_check')).toBeDefined();
    expect(await checkDefinition('group_activity_log_auto_category_check')).toBeDefined();
    const unique = await indexDefinition(UNIQUE_INDEX);
    expect(unique).toMatch(/CREATE UNIQUE INDEX/);
    expect(unique).toMatch(/\(payer_movement_id\)/);
    expect(unique).toMatch(/WHERE \(?payer_movement_id IS NOT NULL\)?/);
    expect(await indexDefinition(PLAIN_INDEX)).toBeUndefined();
  });

  it('adds no float or numeric column to the changed tables and no new table', async () => {
    const columns = await client.query<{ n: string }>(
      `select count(*) as n from information_schema.columns
        where table_schema = 'public' and table_name in ('group_expenses', 'group_activity_log')
          and data_type in ('real', 'double precision', 'numeric')`,
    );
    const sql = await fileOf(`${TAG}.sql`);

    expect(Number(columns.rows[0]?.n)).toBe(0);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|float)\b/i);
    expect(sql).not.toMatch(/REFERENCES\s+"public"\."users"/i);
  });

  it('rejects two expenses with one payer movement and accepts two with a null link', async () => {
    const w = await world();
    const linked = await movement(w);

    expect(await insertExpense(w, linked, true)).toBeUndefined();
    expect(await insertExpense(w, linked, true)).toBe('23505');
    expect(await insertExpense(w, null)).toBeUndefined();
    expect(await insertExpense(w, null)).toBeUndefined();
  });

  it('keeps a null link and the expense when the movement is deleted', async () => {
    const w = await world();
    const linked = await movement(w);
    await insertExpense(w, linked, true);

    await client.query('delete from movements where id = $1', [linked]);

    const row = await client.query(
      'select payer_movement_id, adopted_movement from group_expenses where group_id = $1',
      [w.group],
    );
    expect(row.rows).toEqual([{ payer_movement_id: null, adopted_movement: true }]);
  });

  it('rejects from_movement on any action other than a creation, and keeps the log immutable', async () => {
    const w = await world();

    expect(await insertLog(w, 'expense_updated', true, null)).toBe('23514');
    expect(await insertLog(w, 'expense_updated', false, null)).toBeUndefined();
    expect(await insertLog(w, 'expense_created', true, null)).toBeUndefined();
    expect(await sqlState('update group_activity_log set from_movement = false')).toBe('23001');
    expect(await sqlState('delete from group_activity_log where group_id = $1', [w.group])).toBe(
      '23001',
    );
  });

  it('accepts auto_category created or restored only on a creation from a movement', async () => {
    const w = await world();

    expect(await insertLog(w, 'expense_created', true, 'created')).toBeUndefined();
    expect(await insertLog(w, 'expense_created', true, 'restored')).toBeUndefined();
    expect(await insertLog(w, 'expense_created', true, 'other')).toBe('23514');
    expect(await insertLog(w, 'expense_updated', false, 'created')).toBe('23514');
    expect(await insertLog(w, 'expense_created', false, 'created')).toBe('23514');
  });

  it('aborts the migration with the pre-check when two expenses share a movement, changing nothing', async () => {
    // 0038 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const w = await world();
    const shared = await movement(w);
    await insertExpense(w, shared);
    await insertExpense(w, shared);
    const whensBefore = await appliedWhens();

    await expect(runMigrations(throwawayUrl)).rejects.toThrow();

    expect(await appliedWhens()).toEqual(whensBefore);
    expect(await columnInfo('group_expenses', 'adopted_movement')).toBeUndefined();
    expect(await indexDefinition(UNIQUE_INDEX)).toBeUndefined();

    await client.query(
      `delete from group_expenses where id = (
         select id from group_expenses where payer_movement_id = $1 limit 1)`,
      [shared],
    );
    await runMigrations(throwawayUrl);
    expect(await indexDefinition(UNIQUE_INDEX)).toBeDefined();
  });

  it('is reverted by its rollback, which runs twice, detaches adopted expenses and re-applies', async () => {
    const w = await world();
    const adoptedMovement = await movement(w);
    const plainMovement = await movement(w);
    await insertExpense(w, adoptedMovement, true);
    await insertExpense(w, plainMovement, false);
    const tablesBefore = await publicTableCount();
    const whensBefore = await appliedWhens();

    // 0038 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await columnInfo('group_expenses', 'adopted_movement')).toBeUndefined();
    expect(await columnInfo('group_activity_log', 'from_movement')).toBeUndefined();
    expect(await columnInfo('group_activity_log', 'auto_category')).toBeUndefined();
    expect(await checkDefinition('group_activity_log_from_movement_check')).toBeUndefined();
    expect(await checkDefinition('group_activity_log_auto_category_check')).toBeUndefined();
    expect(await indexDefinition(UNIQUE_INDEX)).toBeUndefined();
    expect(await indexDefinition(PLAIN_INDEX)).toMatch(/\(payer_movement_id\)/);
    expect(await publicTableCount()).toBe(tablesBefore - 3);
    expect(await appliedWhens()).toEqual(whensBefore.slice(0, -5));
    const links = await client.query<{ payer_movement_id: string | null }>(
      'select payer_movement_id from group_expenses where group_id = $1 order by payer_movement_id nulls first',
      [w.group],
    );
    expect(links.rows.map((row) => row.payer_movement_id)).toEqual([null, plainMovement]);
    const kept = await client.query('select 1 from movements where id = $1', [adoptedMovement]);
    expect(kept.rowCount).toBe(1);

    await runMigrations(throwawayUrl);

    expect(await columnInfo('group_expenses', 'adopted_movement')).toBeDefined();
    expect(await indexDefinition(UNIQUE_INDEX)).toBeDefined();
    expect(await indexDefinition(PLAIN_INDEX)).toBeUndefined();
    expect(await appliedWhens()).toEqual(whensBefore);
  });

  it('has the journal entry with the greatest when below 0038, above main, chained to the previous snapshot', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.idx).toBe(37);
    expect(own?.when).toBe(WHEN);
    expect(own?.when).toBeGreaterThan(MAIN_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(...journal.entries.filter((entry) => entry.idx <= 37).map((entry) => entry.when)),
    );
    expect(script).toContain(`"created_at" = ${WHEN}`);
    expect(script).not.toMatch(/DROP TABLE/i);
    const snapshot = JSON.parse(await fileOf('meta/0037_snapshot.json')) as { prevId: string };
    const previous = JSON.parse(await fileOf('meta/0036_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
