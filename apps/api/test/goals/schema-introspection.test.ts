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

const TABLES = ['goal_entries', 'goals'];

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

const constraintNames = async (table: string, type: 'c' | 'u'): Promise<string[]> =>
  (
    await connection.pool.query<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname = $1 and c.contype = $2 order by c.conname`,
      [table, type],
    )
  ).rows.map((row) => row.conname);

describe('goals schema introspection', () => {
  it('has exactly the two goal tables (NFR-01)', async () => {
    const result = await connection.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'goal%' order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(TABLES);
  });

  it('has no float, real, double, numeric or money column and stores amounts as bigint (NFR-01)', async () => {
    const floats = await connection.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [TABLES],
    );
    expect(floats.rows).toEqual([]);
    const amounts = await connection.pool.query<{ table_name: string; data_type: string }>(
      `select table_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and column_name in ('amount', 'target_amount') order by table_name, column_name`,
      [TABLES],
    );
    expect(amounts.rows).toEqual([
      { table_name: 'goal_entries', data_type: 'bigint' },
      { table_name: 'goals', data_type: 'bigint' },
    ]);
  });

  it('declares the check constraints and the unique key of the data model', async () => {
    expect(await constraintNames('goals', 'c')).toEqual([
      'goals_currency_check',
      'goals_name_length_check',
      'goals_target_amount_check',
    ]);
    expect(await constraintNames('goal_entries', 'c')).toEqual([
      'goal_entries_amount_check',
      'goal_entries_kind_check',
    ]);
    expect(await constraintNames('goals', 'u')).toEqual(['goals_id_owner_unique']);
  });

  it('restricts the key to the linked account and cascades the others (AC-23)', async () => {
    expect(await foreignKeys('goals')).toEqual([
      {
        conname: 'goals_account_owner_fk',
        target: 'accounts',
        columns: ['linked_account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'goals_owner_id_users_id_fk',
        target: 'users',
        columns: ['owner_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
    ]);
    expect(await foreignKeys('goal_entries')).toEqual([
      {
        conname: 'goal_entries_goal_owner_fk',
        target: 'goals',
        columns: ['goal_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'c',
      },
      {
        conname: 'goal_entries_owner_id_users_id_fk',
        target: 'users',
        columns: ['owner_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
    ]);
  });

  it('indexes the columns that queries filter on, the account link only where not null', async () => {
    const result = await connection.pool.query<{ indexname: string; indexdef: string }>(
      'select indexname, indexdef from pg_indexes where tablename = any($1) order by indexname',
      [TABLES],
    );
    const names = result.rows.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'goals_owner_created_idx',
        'goals_linked_account_idx',
        'goal_entries_goal_created_idx',
        'goal_entries_owner_idx',
      ]),
    );
    const linked = result.rows.find((row) => row.indexname === 'goals_linked_account_idx');
    expect(linked?.indexdef).toMatch(/linked_account_id IS NOT NULL/);
    const owned = result.rows.find((row) => row.indexname === 'goals_owner_created_idx');
    expect(owned?.indexdef).toMatch(/owner_id, created_at, id/);
  });
});
