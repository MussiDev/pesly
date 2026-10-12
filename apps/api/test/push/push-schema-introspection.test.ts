import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

const columns = async (table: string): Promise<ColumnRow[]> =>
  (
    await connection.pool.query<ColumnRow>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by column_name`,
      [table],
    )
  ).rows;

const indexes = async (table: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await connection.pool.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1",
        [table],
      )
    ).rows.map((row) => [row.indexname, row.indexdef]),
  );

const constraints = async (table: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await connection.pool.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = $1::regclass`,
        [`public.${table}`],
      )
    ).rows.map((row) => [row.conname, row.def]),
  );

const timestamptz = (name: string, nullable: boolean, withDefault: boolean) => ({
  column_name: name,
  data_type: 'timestamp with time zone',
  is_nullable: nullable ? 'YES' : 'NO',
  column_default: withDefault ? 'now()' : null,
});

describe('push_subscriptions introspection', () => {
  it('has the columns of the data model', async () => {
    expect(await columns('push_subscriptions')).toEqual([
      { column_name: 'auth', data_type: 'text', is_nullable: 'NO', column_default: null },
      timestamptz('created_at', false, true),
      { column_name: 'endpoint', data_type: 'text', is_nullable: 'NO', column_default: null },
      {
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        column_default: 'gen_random_uuid()',
      },
      { column_name: 'p256dh', data_type: 'text', is_nullable: 'NO', column_default: null },
      timestamptz('updated_at', false, true),
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
    ]);
  });

  it('has the unique endpoint, the user index and the cascading user key', async () => {
    const found = await indexes('push_subscriptions');
    expect(found.push_subscriptions_endpoint_unique).toMatch(/UNIQUE INDEX .*\(endpoint\)/);
    expect(found.push_subscriptions_user_updated_idx).toMatch(
      /\(user_id, updated_at DESC( NULLS LAST)?, id DESC( NULLS LAST)?\)/,
    );
    const defs = await constraints('push_subscriptions');
    expect(
      Object.values(defs).some((def) => /FOREIGN KEY \(user_id\) .*ON DELETE CASCADE/.test(def)),
    ).toBe(true);
    expect(Object.values(defs).join('\n')).toContain('char_length(endpoint)');
  });
});

describe('push_deliveries introspection', () => {
  it('has the columns of the data model', async () => {
    expect(await columns('push_deliveries')).toEqual([
      {
        column_name: 'attempts',
        data_type: 'smallint',
        is_nullable: 'NO',
        column_default: '0',
      },
      timestamptz('created_at', false, true),
      {
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        column_default: 'gen_random_uuid()',
      },
      timestamptz('lease_until', true, false),
      timestamptz('next_attempt_at', false, true),
      { column_name: 'notice_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      timestamptz('sent_at', true, false),
      {
        column_name: 'status',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: "'pending'::text",
      },
      {
        column_name: 'subscription_id',
        data_type: 'uuid',
        is_nullable: 'NO',
        column_default: null,
      },
      timestamptz('updated_at', false, true),
    ]);
  });

  it('has the unique pair, the three indexes (two partial) and the cascading keys', async () => {
    const found = await indexes('push_deliveries');
    expect(found.push_deliveries_notice_subscription_unique).toMatch(
      /UNIQUE INDEX .*\(notice_id, subscription_id\)/,
    );
    expect(found.push_deliveries_due_idx).toMatch(
      /\(next_attempt_at\) WHERE \(\(?status = 'pending'/,
    );
    expect(found.push_deliveries_subscription_idx).toMatch(/\(subscription_id\)$/);
    expect(found.push_deliveries_done_idx).toMatch(/\(updated_at\) WHERE \(\(?status <> 'pending'/);
    const defs = Object.values(await constraints('push_deliveries')).join('\n');
    expect(defs).toMatch(/FOREIGN KEY \(notice_id\) .*ON DELETE CASCADE/);
    expect(defs).toMatch(/FOREIGN KEY \(subscription_id\) .*ON DELETE CASCADE/);
  });
});

describe('notices push column introspection', () => {
  it('has the nullable push_handled_at and its partial index', async () => {
    const column = (await columns('notices')).find((c) => c.column_name === 'push_handled_at');
    expect(column).toEqual(timestamptz('push_handled_at', true, false));
    expect((await indexes('notices')).notices_push_unhandled_idx).toMatch(
      /\(created_at\) WHERE \(push_handled_at IS NULL\)/,
    );
  });
});
