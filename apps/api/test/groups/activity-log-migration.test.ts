import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0030_group_activity_log_changes';
const PREVIOUS_WHEN = 1791747000000;
const TRIGGER_MESSAGE = /group_activity_log is immutable/;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_activity_log_migration_test`;
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

async function logColumns(): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'group_activity_log'
        and column_name in ('before', 'after') order by column_name`,
  );
  return result.rows.map((row) => row.column_name);
}

async function triggerCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    `select count(*) as n from pg_trigger
      where tgname = 'group_activity_log_immutable' and not tgisinternal`,
  );
  return Number(result.rows[0]?.n);
}

async function functionCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from pg_proc where proname = 'group_activity_log_immutable'",
  );
  return Number(result.rows[0]?.n);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function failure(
  statement: string,
  values: unknown[] = [],
): Promise<{ code?: string; message: string } | undefined> {
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return error as { code?: string; message: string };
  }
}

async function one(statement: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(statement, values);
  return result.rows[0]?.id ?? '';
}

interface Fixture {
  group: string;
  member: string;
}

async function fixture(): Promise<Fixture> {
  const group = await one(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  const member = await one(
    "insert into group_members (group_id, display_name) values ($1, 'Ana') returning id",
    [group],
  );
  return { group, member };
}

const SNAPSHOT = { amount: '1000', currency: 'ARS' };

const insertLog = (
  f: Fixture,
  action: string,
  before: unknown = null,
  after: unknown = null,
  id: string = randomUUID(),
) =>
  failure(
    `insert into group_activity_log (id, group_id, member_id, action, subject_id, created_at, before, after)
     values ($1, $2, $3, $4, $5, now(), $6::jsonb, $7::jsonb)`,
    [
      id,
      f.group,
      f.member,
      action,
      randomUUID(),
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
    ],
  );

describe('0030_group_activity_log_changes migration', () => {
  it('applies on an empty database and adds the columns and the trigger (NFR-01)', async () => {
    expect(await logColumns()).toEqual(['after', 'before']);
    expect(await triggerCount()).toBe(1);
    expect(await functionCount()).toBe(1);
  });

  it('is reverted by its rollback, which runs twice, touching only what it added, and re-applies', async () => {
    const f = await fixture();
    await insertLog(f, 'expense_created');
    await insertLog(f, 'settlement_updated', SNAPSHOT, SNAPSHOT);
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await logColumns()).toEqual([]);
    expect(await triggerCount()).toBe(0);
    expect(await functionCount()).toBe(0);
    expect(await publicTableCount()).toBe(tablesBefore);
    expect(await appliedMigrations()).toBe(countBefore - 1);
    const kept = await client.query(
      'select action from group_activity_log where group_id = $1 order by action',
      [f.group],
    );
    expect(kept.rows).toEqual([{ action: 'expense_created' }]);
    const plainLog = (action: string) =>
      failure(
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         values ($1, $2, $3, $4, now())`,
        [f.group, f.member, action, randomUUID()],
      );
    expect((await plainLog('expense_deleted'))?.code).toBe('23514');
    expect(await plainLog('settlement_created')).toBeUndefined();

    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await logColumns()).toEqual(['after', 'before']);
    expect(await triggerCount()).toBe(1);
  });

  it('rejects an update of a log row with the trigger error and leaves the row unchanged (AC-11)', async () => {
    const f = await fixture();
    const id = randomUUID();
    await insertLog(f, 'expense_deleted', SNAPSHOT, null, id);

    const error = await failure(
      "update group_activity_log set action = 'expense_created', before = null where id = $1",
      [id],
    );
    expect(error?.message).toMatch(TRIGGER_MESSAGE);

    const row = await client.query(
      'select action, before, after from group_activity_log where id = $1',
      [id],
    );
    expect(row.rows).toEqual([{ action: 'expense_deleted', before: SNAPSHOT, after: null }]);
  });

  it('rejects a delete of a log row with the trigger error while the group exists (AC-11)', async () => {
    const f = await fixture();
    const id = randomUUID();
    await insertLog(f, 'expense_created', null, null, id);

    const error = await failure('delete from group_activity_log where id = $1', [id]);
    expect(error?.message).toMatch(TRIGGER_MESSAGE);

    const rows = await client.query('select 1 from group_activity_log where id = $1', [id]);
    expect(rows.rowCount).toBe(1);
  });

  it('deletes the log rows with the group when a group has nothing else (NFR-01)', async () => {
    const f = await fixture();
    await insertLog(f, 'expense_created');
    await insertLog(f, 'expense_updated', SNAPSHOT, SNAPSHOT);
    await insertLog(f, 'settlement_deleted', SNAPSHOT, null);

    expect(await failure('delete from groups where id = $1', [f.group])).toBeUndefined();

    const rows = await client.query('select 1 from group_activity_log where group_id = $1', [
      f.group,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('rejects an updated row without before or after, and a deleted row with after, as a check violation (AC-08, AC-09)', async () => {
    const f = await fixture();

    expect((await insertLog(f, 'expense_updated', null, SNAPSHOT))?.code).toBe('23514');
    expect((await insertLog(f, 'expense_updated', SNAPSHOT, null))?.code).toBe('23514');
    expect((await insertLog(f, 'settlement_updated'))?.code).toBe('23514');
    expect((await insertLog(f, 'expense_deleted', SNAPSHOT, SNAPSHOT))?.code).toBe('23514');
    expect((await insertLog(f, 'settlement_deleted'))?.code).toBe('23514');
    expect((await insertLog(f, 'expense_created', SNAPSHOT))?.code).toBe('23514');
    expect((await insertLog(f, 'settlement_created', null, SNAPSHOT))?.code).toBe('23514');
    expect((await insertLog(f, 'expense_edited'))?.code).toBe('23514');
  });

  it('accepts the six actions with their snapshots (AC-08, AC-09)', async () => {
    const f = await fixture();

    expect(await insertLog(f, 'expense_created')).toBeUndefined();
    expect(await insertLog(f, 'settlement_created')).toBeUndefined();
    expect(await insertLog(f, 'expense_updated', SNAPSHOT, SNAPSHOT)).toBeUndefined();
    expect(await insertLog(f, 'settlement_updated', SNAPSHOT, SNAPSHOT)).toBeUndefined();
    expect(await insertLog(f, 'expense_deleted', SNAPSHOT, null)).toBeUndefined();
    expect(await insertLog(f, 'settlement_deleted', SNAPSHOT, null)).toBeUndefined();
  });

  it('has the journal entry at idx 30 with a when above 0029, and chains its snapshot onto 0029', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(30);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0030_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0029_snapshot.json')).id,
    );
  });
});
