import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const NEWER_WHEN = 1791800000000;
const TAG = '0035_group_expense_payer_movement_idx';
const INDEX = 'group_expenses_payer_movement_idx';
const PREVIOUS_MAX_WHEN = 1791780000000;
const MIDDLE_WHEN = 1791810000000;
const NEWEST_WHEN = 1791820000000;
const PUSH_WHEN = 1791830000000;
const ADJUSTMENT_WHEN = 1791937632948;
const UNIQUE_INDEX = 'group_expenses_payer_movement_unique';

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_spending_migration_test`;
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

async function publicIndexNames(): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = 'public' order by indexname",
  );
  return result.rows.map((row) => row.indexname);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function appliedWhens(): Promise<number[]> {
  const result = await client.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations order by created_at',
  );
  return result.rows.map((row) => Number(row.created_at));
}

async function indexDefinition(name = INDEX): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
    ['public', name],
  );
  return result.rows[0]?.indexdef;
}

describe('0035_group_expense_payer_movement_idx migration', () => {
  it('applies on an empty database and creates the partial index on payer_movement_id', async () => {
    // 0037 replaces this index with a unique one, so it is rolled back to see the 0035 shape.
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    const definition = await indexDefinition();

    expect(definition).toMatch(/\(payer_movement_id\)/);
    expect(definition).toMatch(/WHERE \(?payer_movement_id IS NOT NULL\)?/);
    await runMigrations(throwawayUrl);
  });

  it('is reverted by its idempotent rollback, which removes only the index and its journal row, and re-applies', async () => {
    // 0038, 0037 and 0036 have the greater journal `when`s, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    const indexesBefore = await publicIndexNames();
    const tablesBefore = await publicTableCount();
    const whensBefore = await appliedWhens();

    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await indexDefinition()).toBeUndefined();
    expect(await publicIndexNames()).toEqual(indexesBefore.filter((name) => name !== INDEX));
    expect(await publicTableCount()).toBe(tablesBefore);
    expect(await appliedWhens()).toEqual(whensBefore.slice(0, -1));

    await runMigrations(throwawayUrl);

    // The replay also re-applies 0036 to 0040, and 0037 supersedes the index with its unique one.
    expect(await indexDefinition(UNIQUE_INDEX)).toBeDefined();
    expect(await appliedWhens()).toEqual([
      ...whensBefore,
      NEWER_WHEN,
      MIDDLE_WHEN,
      NEWEST_WHEN,
      PUSH_WHEN,
      ADJUSTMENT_WHEN,
    ]);
  });

  it('applies on top of the previous schema when it already holds group data', async () => {
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const user = await client.query<{ id: string }>(
      `insert into users (email, password_hash, time_zone, language) values ('keep@spending.test', 'h', 'UTC', 'es') returning id`,
    );
    const group = await client.query<{ id: string }>(
      "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
    );
    const member = await client.query<{ id: string }>(
      'insert into group_members (group_id, user_id) values ($1, $2) returning id',
      [group.rows[0]?.id, user.rows[0]?.id],
    );
    const category = await client.query<{ id: string }>(
      `insert into group_categories (group_id, name, icon, color) values ($1, 'Food', 'wallet', 'blue') returning id`,
      [group.rows[0]?.id],
    );
    await client.query(
      `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
         occurred_at, category_id, description, split_mode)
       values ($1, $2, $2, 100, 'ARS', now(), $3, 'Dinner', 'equal')`,
      [group.rows[0]?.id, member.rows[0]?.id, category.rows[0]?.id],
    );

    await runMigrations(throwawayUrl);

    expect(await indexDefinition(UNIQUE_INDEX)).toBeDefined();
    const expenses = await client.query('select 1 from group_expenses where amount = 100');
    expect(expenses.rowCount).toBe(1);
  });

  it('has a rollback script that forgets exactly the journal when of its migration and drops only the index', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBeDefined();
    expect(script).toContain(`"created_at" = ${own?.when}`);
    expect(script).toMatch(/DROP INDEX IF EXISTS "group_expenses_payer_movement_idx"/i);
    expect(script).not.toMatch(/DROP TABLE/i);
  });

  it('has the journal entry with the greatest when, above the previous migration, chained to the previous one', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(35);
    expect(own?.when).toBe(1791790000000);
    expect(own?.when).toBeGreaterThan(PREVIOUS_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= (own?.idx ?? 0))
          .map((entry) => entry.when),
      ),
    );
    const snapshot = JSON.parse(await fileOf('meta/0035_snapshot.json')) as { prevId: string };
    const previousSnapshot = JSON.parse(await fileOf('meta/0034_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previousSnapshot.id);
  });

  it('declares no float or numeric column in the changed table and no column in the migration (NFR-02)', async () => {
    const columns = await client.query<{ n: string }>(
      `select count(*) as n from information_schema.columns
        where table_schema = 'public' and table_name = 'group_expenses'
          and data_type in ('real', 'double precision', 'numeric')`,
    );
    const sql = await fileOf(`${TAG}.sql`);

    expect(Number(columns.rows[0]?.n)).toBe(0);
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|float|ADD COLUMN)\b/i);
    expect(sql).toMatch(/CREATE INDEX "group_expenses_payer_movement_idx"/);
  });
});
