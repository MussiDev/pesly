import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0025_notices';
const NEWER_TAG = '0026_groups';
const PREVIOUS_WHEN = 1791585171427;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_notices_migration_test`;
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

/** 0030, 0029, 0028, 0027 and 0026 have a greater journal `when`, so they go first: the migrator replays only what is newer. */
async function rollBackNewerThan0025(): Promise<void> {
  await client.query(await fileOf('rollback/0030_group_activity_log_changes.down.sql'));
  await client.query(await fileOf('rollback/0029_card_automatic_debit.down.sql'));
  await client.query(await fileOf('rollback/0028_group_settlements.down.sql'));
  await client.query(await fileOf('rollback/0027_group_expenses.down.sql'));
  await client.query(await fileOf(`rollback/${NEWER_TAG}.down.sql`));
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

async function noticesTableExists(): Promise<boolean> {
  const result = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notices'",
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

async function createUser(email: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language)
     values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );
  return result.rows[0]?.id ?? '';
}

async function createPayment(owner: string, reminderDays?: number): Promise<string> {
  const account = (
    await client.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ($1, $2, 'cash', 'ARS', 0, true) returning id`,
      [owner, `Caja ${randomUUID()}`],
    )
  ).rows[0]?.id;
  const category = (
    await client.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color)
       values ($1, 'expense', $2, 'wallet', 'blue') returning id`,
      [owner, `Rent ${randomUUID()}`],
    )
  ).rows[0]?.id;
  const columns = reminderDays === undefined ? '' : ', reminder_days';
  const values = reminderDays === undefined ? '' : `, ${String(reminderDays)}`;
  const payment = (
    await client.query<{ id: string }>(
      `insert into recurring_payments
         (owner_id, name, amount, account_id, category_id, frequency, day_of_month, start_date,
          mode, schedule_from${columns})
       values ($1, 'Rent', 35000000, $2, $3, 'monthly', 5, '2026-09-05', 'confirmation',
               '2026-09-05'${values})
       returning id`,
      [owner, account, category],
    )
  ).rows[0]?.id;
  return payment ?? '';
}

const insertNotice = (owner: string, payment: string, kind: string, text = 'Rent is due soon') =>
  sqlState(
    `insert into notices (owner_id, kind, payment_id, due_date, text)
     values ($1, $2, $3, '2026-10-05', $4)`,
    [owner, kind, payment, text],
  );

describe('0025_notices migration', () => {
  it('gives existing recurring payments reminder_days 3 when it is applied after a rollback (AC-01)', async () => {
    await rollBackNewerThan0025();
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    expect(await paymentColumns()).not.toContain('reminder_days');
    const owner = await createUser('existing@notices.test');
    const payment = await createPayment(owner);

    await runMigrations(throwawayUrl);

    const stored = await client.query<{ reminder_days: number }>(
      'select reminder_days from recurring_payments where id = $1',
      [payment],
    );
    expect(stored.rows[0]?.reminder_days).toBe(3);
  });

  it('refuses a reminder_days outside 0 to 30 with the named check (AC-02)', async () => {
    const owner = await createUser('range@notices.test');

    await expect(createPayment(owner, 31)).rejects.toMatchObject({
      code: '23514',
      constraint: 'recurring_payments_reminder_days_check',
    });
    await expect(createPayment(owner, -1)).rejects.toMatchObject({ code: '23514' });
    await expect(createPayment(owner, 0)).resolves.toBeTruthy();
    await expect(createPayment(owner, 30)).resolves.toBeTruthy();
  });

  it('refuses the same (kind, payment, due date) twice and accepts another kind (AC-23)', async () => {
    const owner = await createUser('unique@notices.test');
    const payment = await createPayment(owner);

    expect(await insertNotice(owner, payment, 'reminder')).toBeUndefined();
    expect(await insertNotice(owner, payment, 'reminder')).toBe('23505');
    expect(await insertNotice(owner, payment, 'recorded')).toBeUndefined();
  });

  it('refuses a kind outside the three and a text outside 1 to 300 characters (NFR-05)', async () => {
    const owner = await createUser('checks@notices.test');
    const payment = await createPayment(owner);

    expect(await insertNotice(owner, payment, 'banner')).toBe('23514');
    expect(await insertNotice(owner, payment, 'not_recorded', 'x'.repeat(301))).toBe('23514');
    expect(await insertNotice(owner, payment, 'not_recorded', '')).toBe('23514');
    expect(await insertNotice(owner, payment, 'not_recorded', 'x'.repeat(300))).toBeUndefined();
  });

  it('cascades from the user to their notices and leaves other users notices (AC-30)', async () => {
    const mine = await createUser('mine@notices.test');
    const theirs = await createUser('theirs@notices.test');
    const myPayment = await createPayment(mine);
    const theirPayment = await createPayment(theirs);
    await insertNotice(mine, myPayment, 'reminder');
    await insertNotice(theirs, theirPayment, 'reminder');

    await client.query('delete from users where id = $1', [mine]);

    const left = await client.query<{ owner_id: string }>(
      'select owner_id from notices where owner_id = any($1)',
      [[mine, theirs]],
    );
    expect(left.rows).toEqual([{ owner_id: theirs }]);
  });

  it('is reverted by its rollback, which runs twice, restoring the 0024 schema, and re-applies (NFR-02)', async () => {
    const before = await paymentColumns();
    const countBefore = await appliedMigrations();

    await rollBackNewerThan0025();
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await paymentColumns()).toEqual(before.filter((name) => name !== 'reminder_days'));
    expect(await noticesTableExists()).toBe(false);
    expect(await appliedMigrations()).toBe(countBefore - 6);
    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await paymentColumns()).toEqual(before);
    expect(await noticesTableExists()).toBe(true);
  });

  it('has the journal entry at idx 25 with a when above 0024, and chains its snapshot onto 0024 (NFR-02)', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(25);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0025_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0024_snapshot.json')).id,
    );
  });
});
