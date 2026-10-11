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

const TABLES = ['group_settlement_legs', 'group_settlements'];

interface ForeignKey {
  target: string;
  columns: string[];
  foreign_columns: string[];
  on_delete: string;
}

async function foreignKeys(table: string): Promise<ForeignKey[]> {
  const result = await connection.pool.query<ForeignKey>(
    `select f.relname as target,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as foreign_columns,
            c.confdeltype as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class f on f.oid = c.confrelid
      where c.contype = 'f' and t.relname = $1
      order by c.conname`,
    [table],
  );
  return result.rows;
}

async function constraintNames(type: 'c' | 'u' | 'p'): Promise<string[]> {
  const result = await connection.pool.query<{ conname: string }>(
    `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
      where c.contype = $1 and t.relname = any($2) order by c.conname`,
    [type, TABLES],
  );
  return result.rows.map((row) => row.conname);
}

async function indexes(tables: string[]): Promise<Record<string, string>> {
  const result = await connection.pool.query<{ indexname: string; indexdef: string }>(
    'select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = any($2)',
    ['public', tables],
  );
  return Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));
}

async function column(
  table: string,
  name: string,
): Promise<{ data_type: string; is_nullable: string } | undefined> {
  const result = await connection.pool.query<{ data_type: string; is_nullable: string }>(
    `select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, name],
  );
  return result.rows[0];
}

describe('group settlements schema introspection', () => {
  it('has the two tables and no float, real, double, numeric or money column (NFR-01)', async () => {
    const tables = await connection.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1) order by table_name`,
      [TABLES],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(TABLES);

    const result = await connection.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [TABLES],
    );
    expect(result.rows).toEqual([]);
  });

  it('stores amounts and the rate as bigint, and left_at as a nullable timestamptz', async () => {
    expect((await column('group_settlements', 'amount'))?.data_type).toBe('bigint');
    expect((await column('group_settlements', 'rate'))?.data_type).toBe('bigint');
    expect((await column('group_settlement_legs', 'amount'))?.data_type).toBe('bigint');
    expect(await column('group_members', 'left_at')).toEqual({
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
    });
  });

  it('has the check constraints of the data model', async () => {
    expect(await constraintNames('c')).toEqual(
      expect.arrayContaining([
        'group_settlements_currency_check',
        'group_settlements_amount_check',
        'group_settlements_distinct_members_check',
        'group_settlements_amount_or_rate_check',
        'group_settlements_rate_positive_check',
        'group_settlements_rate_source_check',
        'group_settlements_rate_fields_check',
        'group_settlements_rate_type_check',
        'group_settlements_account_member_party_check',
        'group_settlement_legs_currency_check',
        'group_settlement_legs_amount_check',
      ]),
    );
    const log = await connection.pool.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'group_activity_log_action_check'`,
    );
    expect(log.rows[0]?.def).toContain('expense_created');
    expect(log.rows[0]?.def).toContain('settlement_created');
  });

  it('has the unique and primary keys', async () => {
    expect(await constraintNames('u')).toEqual(
      expect.arrayContaining(['group_settlements_id_group_unique']),
    );
    expect(await constraintNames('p')).toEqual(
      expect.arrayContaining(['group_settlements_pkey', 'group_settlement_legs_pkey']),
    );
  });

  it('has the list indexes and the active-member indexes', async () => {
    const found = await indexes([...TABLES, 'group_members']);

    expect(found.group_settlements_group_occurred_idx).toMatch(
      /\(group_id, occurred_at DESC( NULLS LAST)?, id DESC/,
    );
    expect(found.group_settlements_account_idx).toMatch(/\(account_id\)/);
    expect(found.group_settlement_legs_group_currency_idx).toMatch(/\(group_id, currency\)/);
    expect(found.group_members_group_user_unique).toMatch(/UNIQUE/);
    expect(found.group_members_group_user_unique).toMatch(/\(group_id, user_id\)/);
    expect(found.group_members_group_user_unique).toMatch(/user_id IS NOT NULL/);
    expect(found.group_members_group_user_unique).toMatch(/left_at IS NULL/);
    expect(found.group_members_group_active_idx).toMatch(/\(group_id\)/);
    expect(found.group_members_group_active_idx).toMatch(/left_at IS NULL/);
  });

  it('ties settlements to members of the same group and the account is set null', async () => {
    const keys = await foreignKeys('group_settlements');
    const member = (name: string) => ({
      target: 'group_members',
      columns: [name, 'group_id'],
      foreign_columns: ['id', 'group_id'],
      on_delete: 'r',
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        member('from_member_id'),
        member('to_member_id'),
        member('created_by_member_id'),
        member('account_member_id'),
        { target: 'groups', columns: ['group_id'], foreign_columns: ['id'], on_delete: 'c' },
        { target: 'accounts', columns: ['account_id'], foreign_columns: ['id'], on_delete: 'n' },
      ]),
    );
    expect(keys).toHaveLength(6);
  });

  it('ties legs to their settlement of the same group and cascades', async () => {
    expect(await foreignKeys('group_settlement_legs')).toEqual([
      {
        target: 'group_settlements',
        columns: ['settlement_id', 'group_id'],
        foreign_columns: ['id', 'group_id'],
        on_delete: 'c',
      },
    ]);
  });
});
