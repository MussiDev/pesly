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

const TABLES = ['movement_rate_limits', 'movements'];

interface ForeignKey {
  conname: string;
  source: string;
  target: string;
  columns: string[];
  foreign_columns: string[];
  on_delete: string;
}

async function foreignKeys(table: string): Promise<ForeignKey[]> {
  const result = await connection.pool.query<ForeignKey>(
    `select c.conname,
            t.relname as source,
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

describe('movements schema introspection', () => {
  it('has both tables', async () => {
    const result = await connection.pool.query<{ tablename: string }>(
      'select tablename from pg_tables where schemaname = $1 and tablename = any($2) order by tablename',
      ['public', TABLES],
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(TABLES);
  });

  it('has no float, real, double or numeric column in either relation', async () => {
    const result = await connection.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [TABLES],
    );
    expect(result.rows).toEqual([]);
  });

  it('stores amounts and rates as bigint and the instant as timestamptz', async () => {
    const result = await connection.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'movements'
          and column_name in ('amount', 'rate', 'occurred_at', 'destination_amount')`,
    );
    const types = Object.fromEntries(result.rows.map((row) => [row.column_name, row.data_type]));
    expect(types).toEqual({
      amount: 'bigint',
      destination_amount: 'bigint',
      rate: 'bigint',
      occurred_at: 'timestamp with time zone',
    });
  });

  it('has the four foreign keys of movements with the expected actions', async () => {
    const keys = await foreignKeys('movements');
    expect(
      keys.map((key) => [
        key.conname,
        key.target,
        key.columns,
        key.foreign_columns,
        // 'a' no action, 'r' restrict, 'c' cascade.
        key.on_delete,
      ]),
    ).toEqual([
      [
        'movements_account_owner_fk',
        'accounts',
        ['account_id', 'owner_id'],
        ['id', 'owner_id'],
        'r',
      ],
      [
        'movements_category_owner_kind_fk',
        'categories',
        ['category_id', 'owner_id', 'type'],
        ['id', 'owner_id', 'kind'],
        'r',
      ],
      [
        'movements_destination_owner_fk',
        'accounts',
        ['destination_account_id', 'owner_id'],
        ['id', 'owner_id'],
        'r',
      ],
      ['movements_owner_id_users_id_fk', 'users', ['owner_id'], ['id'], 'c'],
    ]);
  });

  it('cascades both keys to users', async () => {
    const keys = [
      ...(await foreignKeys('movements')),
      ...(await foreignKeys('movement_rate_limits')),
    ];
    const toUsers = keys.filter((key) => key.target === 'users');
    expect(toUsers.map((key) => key.source).sort()).toEqual(['movement_rate_limits', 'movements']);
    expect(toUsers.every((key) => key.on_delete === 'c')).toBe(true);
  });

  it('has no key to exchange_rates (the rate is frozen, never joined)', async () => {
    const keys = [
      ...(await foreignKeys('movements')),
      ...(await foreignKeys('movement_rate_limits')),
    ];
    expect(keys.filter((key) => key.target === 'exchange_rates')).toEqual([]);
  });

  it('has the list and restrict-check indexes', async () => {
    const result = await connection.pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'movements'
        order by indexname`,
    );
    expect(result.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'movements_account_idx',
        'movements_category_idx',
        'movements_destination_idx',
        'movements_owner_date_idx',
      ]),
    );
  });

  it('gives movement_rate_limits a primary key of owner and window start', async () => {
    const result = await connection.pool.query<{ columns: string[] }>(
      `select array_agg(a.attname::text order by k.ord) as columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'p' and t.relname = 'movement_rate_limits'`,
    );
    expect(result.rows[0]?.columns).toEqual(['owner_id', 'window_start']);
  });

  it('adds the unique constraint on accounts (id, owner_id) that the composite key targets', async () => {
    const result = await connection.pool.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'u' and conname = 'accounts_id_owner_unique'`,
    );
    expect(result.rows).toHaveLength(1);
  });
});
