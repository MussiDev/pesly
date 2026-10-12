import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0031_group_record_version';
const PREVIOUS_WHEN = 1791750000000;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_record_version_migration_test`;
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

interface VersionColumn {
  table_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function versionColumns(): Promise<VersionColumn[]> {
  const result = await client.query<VersionColumn>(
    `select table_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and column_name = 'version'
        and table_name in ('group_expenses', 'group_settlements') order by table_name`,
  );
  return result.rows;
}

async function checkNames(): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    `select conname from pg_constraint
      where conname in ('group_expenses_version_check', 'group_settlements_version_check')
      order by conname`,
  );
  return result.rows.map((row) => row.conname);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
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

async function one(statement: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(statement, values);
  return result.rows[0]?.id ?? '';
}

interface Fixture {
  group: string;
  from: string;
  to: string;
  category: string;
}

async function fixture(): Promise<Fixture> {
  const group = await one(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  const member = (name: string) =>
    one('insert into group_members (group_id, display_name) values ($1, $2) returning id', [
      group,
      name,
    ]);
  const category = await one(
    `insert into group_categories (group_id, default_key, icon, color)
     values ($1, 'food', 'utensils', 'red') returning id`,
    [group],
  );
  return { group, from: await member('Ana'), to: await member('Pedro'), category };
}

/** Inserts without a version when none is given, so the column default is what gets exercised. */
const insertExpense = (f: Fixture, version?: number, id: string = randomUUID()) =>
  version === undefined
    ? sqlState(
        `insert into group_expenses
           (id, group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
            category_id, description, split_mode)
         values ($1, $2, $3, $3, 1000, 'ARS', now(), $4, 'Dinner', 'equal')`,
        [id, f.group, f.from, f.category],
      )
    : sqlState(
        `insert into group_expenses
           (id, group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
            category_id, description, split_mode, version)
         values ($1, $2, $3, $3, 1000, 'ARS', now(), $4, 'Dinner', 'equal', $5)`,
        [id, f.group, f.from, f.category, version],
      );

const insertSettlement = (f: Fixture, version?: number, id: string = randomUUID()) =>
  version === undefined
    ? sqlState(
        `insert into group_settlements
           (id, group_id, from_member_id, to_member_id, currency, amount, occurred_at,
            created_by_member_id)
         values ($1, $2, $3, $4, 'ARS', 1000, now(), $3)`,
        [id, f.group, f.from, f.to],
      )
    : sqlState(
        `insert into group_settlements
           (id, group_id, from_member_id, to_member_id, currency, amount, occurred_at,
            created_by_member_id, version)
         values ($1, $2, $3, $4, 'ARS', 1000, now(), $3, $5)`,
        [id, f.group, f.from, f.to, version],
      );

describe('0031_group_record_version migration', () => {
  it('adds both version columns as integer not null default 1 with their checks (AC-01)', async () => {
    expect(await versionColumns()).toEqual([
      {
        table_name: 'group_expenses',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '1',
      },
      {
        table_name: 'group_settlements',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '1',
      },
    ]);
    expect(await checkNames()).toEqual([
      'group_expenses_version_check',
      'group_settlements_version_check',
    ]);
  });

  it('gives version 1 to rows inserted without one', async () => {
    const f = await fixture();
    const expense = randomUUID();
    const settlement = randomUUID();
    expect(await insertExpense(f, undefined, expense)).toBeUndefined();
    expect(await insertSettlement(f, undefined, settlement)).toBeUndefined();

    const expenses = await client.query('select version from group_expenses where id = $1', [
      expense,
    ]);
    const settlements = await client.query('select version from group_settlements where id = $1', [
      settlement,
    ]);
    expect(expenses.rows).toEqual([{ version: 1 }]);
    expect(settlements.rows).toEqual([{ version: 1 }]);
  });

  it('rejects version 0 on both tables as a check violation (invalid input)', async () => {
    const f = await fixture();

    expect(await insertExpense(f, 0)).toBe('23514');
    expect(await insertSettlement(f, 0)).toBe('23514');
    expect(await insertExpense(f, 2)).toBeUndefined();
    expect(await insertSettlement(f, 2)).toBeUndefined();
  });

  it('is reverted by its rollback, which runs twice, leaving the 0030 shape, and re-applies', async () => {
    const f = await fixture();
    await insertExpense(f);
    await insertSettlement(f);
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    // 0032 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf('rollback/0035_group_expense_payer_movement_idx.down.sql'));
    await client.query(await fileOf('rollback/0034_budgets.down.sql'));
    await client.query(await fileOf('rollback/0033_savings_goals.down.sql'));
    await client.query(await fileOf('rollback/0032_card_statement_reminders.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await versionColumns()).toEqual([]);
    expect(await checkNames()).toEqual([]);
    expect(await publicTableCount()).toBe(tablesBefore - 7);
    expect(await appliedMigrations()).toBe(countBefore - 7);
    const kept = await client.query('select 1 from group_expenses where group_id = $1', [f.group]);
    expect(kept.rowCount).toBe(1);

    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await versionColumns()).toHaveLength(2);
    expect(await checkNames()).toHaveLength(2);
    const reapplied = await client.query('select version from group_expenses where group_id = $1', [
      f.group,
    ]);
    expect(reapplied.rows).toEqual([{ version: 1 }]);
  });

  it('has the journal entry at idx 31 with a when above 0030, and chains its snapshot onto 0030', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(31);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0031_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0030_snapshot.json')).id,
    );
  });
});
