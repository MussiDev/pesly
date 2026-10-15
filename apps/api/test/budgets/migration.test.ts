import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0034_budgets';
const NEWER_TAG = '0035_group_expense_payer_movement_idx';
const MAIN_MAX_WHEN = 1791760600000;
const TABLES = [
  'budgets',
  'budget_versions',
  'budget_version_categories',
  'budget_version_thresholds',
];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_budgets_migration_test`;
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

async function existingTables(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1) order by table_name`,
    [TABLES],
  );
  return result.rows.map((row) => row.table_name);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

describe('0034_budgets migration', () => {
  it('applies on an empty database and creates the four tables', async () => {
    expect(await existingTables()).toEqual([...TABLES].sort());
  });

  it('is reverted by its idempotent rollback, which removes only the four tables, and re-applies', async () => {
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    // 0036 and 0035 have the greater journal `when`s, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf(`rollback/${NEWER_TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await existingTables()).toEqual([]);
    expect(await publicTableCount()).toBe(tablesBefore - 8);
    expect(await appliedMigrations()).toBe(countBefore - 7);

    await runMigrations(throwawayUrl);

    expect(await existingTables()).toEqual([...TABLES].sort());
    expect(await appliedMigrations()).toBe(countBefore);
  });

  it('applies on top of the previous schema when it already holds data', async () => {
    // 0036 and 0035 have the greater journal `when`s, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf(`rollback/${NEWER_TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(
      `insert into users (email, password_hash, time_zone, language) values ('keep@budgets.test', 'h', 'UTC', 'es')`,
    );

    await runMigrations(throwawayUrl);

    expect(await existingTables()).toEqual([...TABLES].sort());
    const users = await client.query("select 1 from users where email = 'keep@budgets.test'");
    expect(users.rowCount).toBe(1);
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBeDefined();
    expect(script).toContain(`"created_at" = ${own?.when}`);
  });

  it('has the journal entry with the greatest when up to its idx, above main, chained to the previous one', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.when).toBeGreaterThan(MAIN_MAX_WHEN);
    // Newer migrations (0035, 0036) come after it, so it is the greatest among its own and the older ones.
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= (own?.idx ?? 0))
          .map((entry) => entry.when),
      ),
    );
    const snapshots = JSON.parse(
      await fileOf(`meta/${String(own?.idx).padStart(4, '0')}_snapshot.json`),
    ) as { prevId: string };
    // Numbers may have gaps (0008), so take the closest lower one.
    const previous = journal.entries
      .filter((entry) => entry.idx < (own?.idx ?? 0))
      .sort((a, b) => b.idx - a.idx)[0];
    const previousSnapshot = JSON.parse(
      await fileOf(`meta/${(previous?.tag ?? '').slice(0, 4)}_snapshot.json`),
    ) as { id: string };
    expect(snapshots.prevId).toBe(previousSnapshot.id);
  });
});
