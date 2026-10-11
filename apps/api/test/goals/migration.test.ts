import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0033_savings_goals';
const PREVIOUS_WHEN = 1791760600000;
const GOAL_TABLES = ['goal_entries', 'goals'];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_goals_migration_test`;
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

async function goalTables(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1) order by table_name`,
    [GOAL_TABLES],
  );
  return result.rows.map((row) => row.table_name);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function countOf(statement: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ n: string }>(statement, values);
  return Number(result.rows[0]?.n);
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

async function createAccount(owner: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, 'Cash', 'cash', 'ARS', 1000, true) returning id`,
    [owner],
  );
  return result.rows[0]?.id ?? '';
}

async function createGoal(owner: string, account: string | null = null): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into goals (owner_id, name, target_amount, currency, linked_account_id)
     values ($1, 'Trip', 100000, 'ARS', $2) returning id`,
    [owner, account],
  );
  return result.rows[0]?.id ?? '';
}

const insertGoal = (
  owner: string,
  fields: { name?: string; target?: number; currency?: string },
): Promise<string | undefined> =>
  sqlState('insert into goals (owner_id, name, target_amount, currency) values ($1, $2, $3, $4)', [
    owner,
    fields.name ?? 'Trip',
    fields.target ?? 100,
    fields.currency ?? 'ARS',
  ]);

const insertEntry = (
  goal: string,
  owner: string,
  kind: string,
  amount: number,
): Promise<string | undefined> =>
  sqlState('insert into goal_entries (goal_id, owner_id, kind, amount) values ($1, $2, $3, $4)', [
    goal,
    owner,
    kind,
    amount,
  ]);

describe('0033_savings_goals migration', () => {
  it('applies on an empty database and creates the two goal tables (NFR-01)', async () => {
    expect(await goalTables()).toEqual(GOAL_TABLES);
  });

  it('refuses a target of 0, a currency other than ARS and USD and an empty or long name (AC-02, AC-17)', async () => {
    const owner = await createUser('checks@goals.test');

    expect(await insertGoal(owner, { target: 0 })).toBe('23514');
    expect(await insertGoal(owner, { currency: 'EUR' })).toBe('23514');
    expect(await insertGoal(owner, { name: '' })).toBe('23514');
    expect(await insertGoal(owner, { name: 'x'.repeat(81) })).toBe('23514');
    expect(await insertGoal(owner, { name: 'x'.repeat(80), currency: 'USD' })).toBeUndefined();
  });

  it('refuses an entry of amount 0 and an entry with an unknown kind (AC-20)', async () => {
    const owner = await createUser('entries@goals.test');
    const goal = await createGoal(owner);

    expect(await insertEntry(goal, owner, 'contribution', 0)).toBe('23514');
    expect(await insertEntry(goal, owner, 'refund', 10)).toBe('23514');
    expect(await insertEntry(goal, owner, 'contribution', 10)).toBeUndefined();
    expect(await insertEntry(goal, owner, 'withdrawal', 5)).toBeUndefined();
  });

  it("refuses a goal that links to another user's account, and an entry of another owner (AC-18)", async () => {
    const ana = await createUser('ana@goals.test');
    const bea = await createUser('bea@goals.test');
    const beaAccount = await createAccount(bea);
    const goal = await createGoal(ana);

    await expect(createGoal(ana, beaAccount)).rejects.toMatchObject({ code: '23503' });
    expect(await insertEntry(goal, bea, 'contribution', 10)).toBe('23503');
  });

  it('deletes the entries with their goal and changes no account or movement (AC-14)', async () => {
    const owner = await createUser('cascade@goals.test');
    const account = await createAccount(owner);
    const goal = await createGoal(owner);
    await insertEntry(goal, owner, 'contribution', 10);
    const accountsBefore = await countOf('select count(*) as n from accounts');
    const movementsBefore = await countOf('select count(*) as n from movements');

    await client.query('delete from goals where id = $1', [goal]);

    expect(await countOf('select count(*) as n from goal_entries where goal_id = $1', [goal])).toBe(
      0,
    );
    expect(await countOf('select count(*) as n from accounts')).toBe(accountsBefore);
    expect(await countOf('select count(*) as n from movements')).toBe(movementsBefore);
    expect(await countOf('select count(*) as n from accounts where id = $1', [account])).toBe(1);
  });

  it('refuses to delete an account a goal links to and keeps both rows (AC-23)', async () => {
    const owner = await createUser('restrict@goals.test');
    const account = await createAccount(owner);
    const goal = await createGoal(owner, account);

    expect(await sqlState('delete from accounts where id = $1', [account])).toBe('23503');
    expect(await countOf('select count(*) as n from accounts where id = $1', [account])).toBe(1);
    expect(await countOf('select count(*) as n from goals where id = $1', [goal])).toBe(1);
  });

  it('is reverted by its rollback, which runs twice, touching only the two tables, and re-applies', async () => {
    const owner = await createUser('rollback@goals.test');
    await createGoal(owner);
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    // 0035 and 0034 have the greater journal `when`s, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf('rollback/0035_group_expense_payer_movement_idx.down.sql'));
    await client.query(await fileOf('rollback/0034_budgets.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await goalTables()).toEqual([]);
    expect(await publicTableCount()).toBe(tablesBefore - GOAL_TABLES.length - 5);
    expect(await appliedMigrations()).toBe(countBefore - 4);
    expect(await countOf('select count(*) as n from users where id = $1', [owner])).toBe(1);

    await runMigrations(throwawayUrl);

    expect(await appliedMigrations()).toBe(countBefore);
    expect(await goalTables()).toEqual(GOAL_TABLES);
  });

  it('has the journal entry at idx 33 with a when above 0032, and chains its snapshot onto 0032', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(33);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0033_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0032_snapshot.json')).id,
    );
  });
});
