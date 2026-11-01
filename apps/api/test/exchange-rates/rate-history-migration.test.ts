import { readFile } from 'node:fs/promises';
import { RATE_TYPES } from '@pesly/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0038_exchange_rate_history';
const PREVIOUS_MAX_WHEN = 1791810000000;
const HOOK_TIMEOUT_MS = 60_000;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_rate_history_migration_test`;
  return url.toString();
})();

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

async function tableExists(name: string): Promise<boolean> {
  const result = await client.query<{ t: string | null }>('select to_regclass($1) as t', [
    `public.${name}`,
  ]);
  return result.rows[0]?.t !== null;
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function publicTableCount(): Promise<string | undefined> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return result.rows[0]?.n;
}

const insertHistory = (rateType: string, date: string, buy: number, sell: number) =>
  client.query(
    `insert into exchange_rate_history (rate_type, rate_date, buy, sell, recorded_at)
     values ($1, $2, $3, $4, now())`,
    [rateType, date, buy, sell],
  );

describe('0038_exchange_rate_history migration', () => {
  it('creates the table with no float column', async () => {
    expect(await tableExists('exchange_rate_history')).toBe(true);
    const floats = await client.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'exchange_rate_history'
          and data_type in ('real', 'double precision', 'numeric')`,
    );
    expect(floats.rowCount).toBe(0);
  });

  it('refuses an unknown rate type, a sell of 0 and a duplicate key', async () => {
    await client.query('delete from exchange_rate_history');
    await expect(insertHistory('made_up', '2026-10-01', 100, 100)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertHistory('blue', '2026-10-01', 100, 0)).rejects.toMatchObject({
      code: '23514',
    });
    await insertHistory('blue', '2026-10-01', 100, 110);
    await expect(insertHistory('blue', '2026-10-01', 101, 111)).rejects.toMatchObject({
      code: '23505',
    });
    await client.query('delete from exchange_rate_history');
  });

  it('(AC-41) seeds one history row per stored rate, dated by fetched_at in Argentina', async () => {
    // 0039 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    for (const [index, type] of RATE_TYPES.entries()) {
      // The first one was fetched at 02:00 UTC, which is still the previous day in Argentina.
      const fetchedAt = index === 0 ? '2026-10-03T02:00:00Z' : '2026-10-02T12:00:00Z';
      await client.query(
        `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
         values ($1, $2, $3, '2026-10-02T11:00:00Z', $4)`,
        [type, 1000000 + index, 1010000 + index, fetchedAt],
      );
    }

    await runMigrations(throwawayUrl);

    const rows = await client.query<{
      rate_type: string;
      rate_date: string;
      buy: string;
      sell: string;
    }>(
      `select rate_type, to_char(rate_date, 'YYYY-MM-DD') as rate_date, buy::text, sell::text
         from exchange_rate_history order by rate_type`,
    );
    const stored = await client.query<{ rate_type: string; buy: string; sell: string }>(
      'select rate_type, buy::text, sell::text from exchange_rates order by rate_type',
    );
    expect(rows.rowCount).toBe(7);
    expect(rows.rows.map(({ rate_type, buy, sell }) => ({ rate_type, buy, sell }))).toEqual(
      stored.rows,
    );
    expect(rows.rows.every((row) => row.rate_date === '2026-10-02')).toBe(true);
    await client.query('delete from exchange_rate_history');
    await client.query('delete from exchange_rates');
  });

  it('is reverted twice by its idempotent rollback, removes only its journal row, and re-applies', async () => {
    await client.query(
      `insert into users (email, password_hash, time_zone, language) values ('keep@history.test', 'h', 'UTC', 'es')`,
    );
    const countBefore = await appliedMigrations();
    const tablesBefore = await publicTableCount();

    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await tableExists('exchange_rate_history')).toBe(false);
    expect(await appliedMigrations()).toBe(countBefore - 5);
    const users = await client.query("select 1 from users where email = 'keep@history.test'");
    expect(users.rowCount).toBe(1);

    await runMigrations(throwawayUrl);

    expect(await tableExists('exchange_rate_history')).toBe(true);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await publicTableCount()).toBe(tablesBefore);
    const stillThere = await client.query("select 1 from users where email = 'keep@history.test'");
    expect(stillThere.rowCount).toBe(1);
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBe(1791820000000);
    expect(script).toContain(`"created_at" = ${own?.when}`);
  });

  it('has the journal entry at idx 38 with the greatest when, chained to 0037', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(38);
    expect(own?.when).toBeGreaterThan(PREVIOUS_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(...journal.entries.filter((entry) => entry.idx <= 38).map((entry) => entry.when)),
    );
    const snapshot = JSON.parse(await fileOf('meta/0038_snapshot.json')) as { prevId: string };
    const previous = JSON.parse(await fileOf('meta/0037_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
