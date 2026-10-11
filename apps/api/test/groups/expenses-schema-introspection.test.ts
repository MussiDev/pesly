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

const TABLES = [
  'group_activity_log',
  'group_default_split_shares',
  'group_expense_shares',
  'group_expenses',
];

interface ForeignKey {
  conname: string;
  target: string;
  columns: string[];
  foreign_columns: string[];
  on_delete: string;
}

async function foreignKeys(table: string): Promise<ForeignKey[]> {
  const result = await connection.pool.query<ForeignKey>(
    `select c.conname,
            f.relname as target,
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

const fkSummary = async (table: string) =>
  (await foreignKeys(table)).map((fk) => ({
    target: fk.target,
    columns: fk.columns,
    foreign_columns: fk.foreign_columns,
    on_delete: fk.on_delete,
  }));

async function constraintNames(type: 'c' | 'u' | 'p'): Promise<string[]> {
  const result = await connection.pool.query<{ conname: string }>(
    `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
      where c.contype = $1 and t.relname = any($2) order by c.conname`,
    [type, TABLES],
  );
  return result.rows.map((row) => row.conname);
}

async function indexes(): Promise<Record<string, string>> {
  const result = await connection.pool.query<{ indexname: string; indexdef: string }>(
    'select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = any($2)',
    ['public', TABLES],
  );
  return Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));
}

async function columnType(table: string, column: string): Promise<string | undefined> {
  const result = await connection.pool.query<{ data_type: string }>(
    `select data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return result.rows[0]?.data_type;
}

describe('group expenses schema introspection', () => {
  it('has the four tables and no float, real, double, numeric or money column (NFR-01)', async () => {
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

  it('stores amounts as bigint and basis points as integer', async () => {
    expect(await columnType('group_expenses', 'amount')).toBe('bigint');
    expect(await columnType('group_expense_shares', 'amount')).toBe('bigint');
    expect(await columnType('group_expense_shares', 'basis_points')).toBe('integer');
    expect(await columnType('group_default_split_shares', 'basis_points')).toBe('integer');
  });

  it('has the check constraints of the data model', async () => {
    expect(await constraintNames('c')).toEqual(
      expect.arrayContaining([
        'group_expenses_amount_check',
        'group_expenses_currency_check',
        'group_expenses_description_length_check',
        'group_expenses_split_mode_check',
        'group_expense_shares_amount_check',
        'group_expense_shares_basis_points_check',
        'group_default_split_shares_basis_points_check',
        'group_activity_log_action_check',
      ]),
    );
    const mode = await connection.pool.query(
      `select 1 from pg_constraint where conname = 'groups_default_split_mode_check'`,
    );
    expect(mode.rowCount).toBe(1);
  });

  it('has the unique and primary keys', async () => {
    expect(await constraintNames('u')).toEqual(
      expect.arrayContaining(['group_expenses_id_group_unique']),
    );
    expect(await constraintNames('p')).toEqual(
      expect.arrayContaining([
        'group_expenses_pkey',
        'group_expense_shares_pkey',
        'group_default_split_shares_pkey',
        'group_activity_log_pkey',
      ]),
    );
  });

  it('has the list indexes', async () => {
    const found = await indexes();
    expect(Object.keys(found)).toEqual(
      expect.arrayContaining([
        'group_expenses_group_occurred_idx',
        'group_expenses_payer_idx',
        'group_expense_shares_member_idx',
        'group_activity_log_group_created_idx',
      ]),
    );
    expect(found.group_expenses_group_occurred_idx).toMatch(
      /\(group_id, occurred_at DESC( NULLS LAST)?, id DESC/,
    );
    expect(found.group_activity_log_group_created_idx).toMatch(
      /\(group_id, created_at DESC( NULLS LAST)?, id DESC/,
    );
    expect(found.group_expense_shares_member_idx).toMatch(/\(member_id, expense_id\)/);
  });

  it('ties expenses to members of the same group, and the movement is set null', async () => {
    const keys = await fkSummary('group_expenses');
    expect(keys).toEqual(
      expect.arrayContaining([
        {
          target: 'group_members',
          columns: ['payer_member_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'r',
        },
        {
          target: 'group_members',
          columns: ['created_by_member_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'r',
        },
        { target: 'groups', columns: ['group_id'], foreign_columns: ['id'], on_delete: 'c' },
        {
          target: 'group_categories',
          columns: ['category_id'],
          foreign_columns: ['id'],
          on_delete: 'a',
        },
        {
          target: 'movements',
          columns: ['payer_movement_id'],
          foreign_columns: ['id'],
          on_delete: 'n',
        },
      ]),
    );
    expect(keys).toHaveLength(5);
  });

  it('ties shares, default split and log to members of the same group', async () => {
    expect(await fkSummary('group_expense_shares')).toEqual(
      expect.arrayContaining([
        {
          target: 'group_expenses',
          columns: ['expense_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'c',
        },
        {
          target: 'group_members',
          columns: ['member_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'r',
        },
      ]),
    );
    expect(await fkSummary('group_default_split_shares')).toEqual(
      expect.arrayContaining([
        {
          target: 'group_members',
          columns: ['member_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'c',
        },
        { target: 'groups', columns: ['group_id'], foreign_columns: ['id'], on_delete: 'c' },
      ]),
    );
    expect(await fkSummary('group_activity_log')).toEqual(
      expect.arrayContaining([
        {
          target: 'group_members',
          columns: ['member_id', 'group_id'],
          foreign_columns: ['id', 'group_id'],
          on_delete: 'r',
        },
        { target: 'groups', columns: ['group_id'], foreign_columns: ['id'], on_delete: 'c' },
      ]),
    );
  });
});
