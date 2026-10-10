import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0024_recurring_auto_recording_from';
const PREVIOUS_WHEN = 1791563194787;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_auto_from_migration_test`;
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

/** 0025 has the greatest journal `when`, so it is rolled back before 0024. */
async function rollBackTo0023(): Promise<void> {
  await client.query(await fileOf('rollback/0025_notices.down.sql'));
  await client.query(await fileOf(`rollback/${TAG}.down.sql`));
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function paymentColumns(): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'recurring_payments' order by column_name`,
  );
  return result.rows.map((row) => row.column_name);
}

async function insertPayment(timeZone: string, createdAt: string, email: string): Promise<string> {
  const owner = (
    await client.query<{ id: string }>(
      `insert into users (email, password_hash, time_zone, language)
       values ($1, 'h', $2, 'es') returning id`,
      [email, timeZone],
    )
  ).rows[0]?.id;
  const account = (
    await client.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ($1, 'Caja', 'cash', 'ARS', 0, true) returning id`,
      [owner],
    )
  ).rows[0]?.id;
  const category = (
    await client.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color)
       values ($1, 'expense', 'Rent', 'wallet', 'blue') returning id`,
      [owner],
    )
  ).rows[0]?.id;
  const payment = (
    await client.query<{ id: string }>(
      `insert into recurring_payments
         (owner_id, name, amount, account_id, category_id, frequency, day_of_month, start_date,
          mode, schedule_from, created_at)
       values ($1, 'Rent', 35000000, $2, $3, 'monthly', 5, '2026-09-05', 'automatic',
               '2026-09-05', $4)
       returning id`,
      [owner, account, category, createdAt],
    )
  ).rows[0]?.id;
  return payment ?? '';
}

const autoFrom = async (payment: string): Promise<string | undefined> =>
  (
    await client.query<{ day: string }>(
      'select auto_recording_from::text as day from recurring_payments where id = $1',
      [payment],
    )
  ).rows[0]?.day;

describe('0024_recurring_auto_recording_from migration (FR-05)', () => {
  it('backfills the column from created_at in the owner zone, UTC for an unknown zone, and re-applies after a rollback', async () => {
    await rollBackTo0023();
    expect(await paymentColumns()).not.toContain('auto_recording_from');
    expect(await appliedMigrations()).toBe(23);
    const tokyo = await insertPayment('Asia/Tokyo', '2026-10-04T20:00:00Z', 'tokyo@auto.test');
    const buenosAires = await insertPayment(
      'America/Argentina/Buenos_Aires',
      '2026-10-05T02:00:00Z',
      'ba@auto.test',
    );
    const unknown = await insertPayment('Not/AZone', '2026-10-05T23:30:00Z', 'bad@auto.test');

    await runMigrations(throwawayUrl);

    expect(await paymentColumns()).toContain('auto_recording_from');
    expect(await appliedMigrations()).toBe(25);
    expect(await autoFrom(tokyo)).toBe('2026-10-05');
    expect(await autoFrom(buenosAires)).toBe('2026-10-04');
    expect(await autoFrom(unknown)).toBe('2026-10-05');
  });

  it('keeps the column not null with a current_date default for raw inserts', async () => {
    const payment = await insertPayment('UTC', '2026-10-05T10:00:00Z', 'raw@auto.test');

    const stored = await autoFrom(payment);

    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(
      client.query('update recurring_payments set auto_recording_from = null where id = $1', [
        payment,
      ]),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('is reverted by its rollback, which runs twice, restoring the 0023 schema, and re-applies', async () => {
    const before = await paymentColumns();
    const tableCount = async () =>
      Number(
        (
          await client.query<{ n: string }>(
            "select count(*) as n from information_schema.tables where table_name like 'recurring%'",
          )
        ).rows[0]?.n,
      );

    await rollBackTo0023();
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await paymentColumns()).toEqual(
      before.filter((name) => name !== 'auto_recording_from' && name !== 'reminder_days'),
    );
    expect(await tableCount()).toBe(2);
    expect(await appliedMigrations()).toBe(23);
    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(25);
    expect(await paymentColumns()).toEqual(before);
  });

  it('sad path: a failing migration rolls back its transaction and leaves the schema unchanged', async () => {
    await rollBackTo0023();
    const before = await paymentColumns();
    const statements = (await fileOf(`${TAG}.sql`))
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(1);

    await client.query('begin');
    for (const statement of statements) await client.query(statement);
    expect(await paymentColumns()).toContain('auto_recording_from');
    const failure = await client.query('select 1 / 0').then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    await client.query('rollback');

    expect(failure?.code).toBe('22012');
    expect(await paymentColumns()).toEqual(before);
    expect(await appliedMigrations()).toBe(23);
    await runMigrations(throwawayUrl);
  });

  it('has the journal entry at idx 24 with a when above 0023 and below 0025, and chains its snapshot onto 0023', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(24);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect(own?.when).toBeLessThan(
      journal.entries.find((entry) => entry.tag === '0025_notices')?.when ?? 0,
    );
    expect((await read<{ prevId: string }>('0024_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0023_snapshot.json')).id,
    );
  });
});
