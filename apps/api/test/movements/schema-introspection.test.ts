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

const TABLES = ['movement_rate_limits', 'movement_tags', 'movements', 'tags'];

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
  it('has the four tables', async () => {
    const result = await connection.pool.query<{ tablename: string }>(
      'select tablename from pg_tables where schemaname = $1 and tablename = any($2) order by tablename',
      ['public', TABLES],
    );
    expect(result.rows.map((row) => row.tablename).sort()).toEqual([...TABLES].sort());
  });

  it('has no float, real, double or numeric column in any of the relations', async () => {
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
        'movements_owner_account_date_idx',
        'movements_owner_category_date_idx',
        'movements_owner_date_idx',
      ]),
    );
  });

  it('gives movement_rate_limits a primary key of owner, bucket and window start', async () => {
    const result = await connection.pool.query<{ columns: string[] }>(
      `select array_agg(a.attname::text order by k.ord) as columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'p' and t.relname = 'movement_rate_limits'`,
    );
    expect(result.rows[0]?.columns).toEqual(['owner_id', 'bucket', 'window_start']);
  });

  it('adds the unique constraint on accounts (id, owner_id) that the composite key targets', async () => {
    const result = await connection.pool.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'u' and conname = 'accounts_id_owner_unique'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('adds the unique constraint on movements (id, owner_id) that the link key targets', async () => {
    const result = await connection.pool.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'u' and conname = 'movements_id_owner_unique'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('has the composite indexes ordered by date', async () => {
    const result = await connection.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public'
        and indexname in ('movements_owner_account_date_idx', 'movements_owner_category_date_idx')
        order by indexname`,
    );
    expect(result.rows.map((row) => row.indexname)).toEqual([
      'movements_owner_account_date_idx',
      'movements_owner_category_date_idx',
    ]);
    expect(result.rows[0]?.indexdef).toMatch(
      /\(owner_id, account_id, occurred_at DESC NULLS LAST, id DESC NULLS LAST\)/,
    );
    expect(result.rows[1]?.indexdef).toMatch(
      /\(owner_id, category_id, occurred_at DESC NULLS LAST, id DESC NULLS LAST\)/,
    );
  });

  it('has the two composite keys of movement_tags, both cascading, and the key of tags to users', async () => {
    const keys = await foreignKeys('movement_tags');
    expect(
      keys.map((key) => [key.conname, key.target, key.columns, key.foreign_columns, key.on_delete]),
    ).toEqual([
      [
        'movement_tags_movement_owner_fk',
        'movements',
        ['movement_id', 'owner_id'],
        ['id', 'owner_id'],
        'c',
      ],
      ['movement_tags_tag_owner_fk', 'tags', ['tag_id', 'owner_id'], ['id', 'owner_id'], 'c'],
    ]);
    const tagKeys = await foreignKeys('tags');
    expect(tagKeys.map((key) => [key.target, key.columns, key.on_delete])).toEqual([
      ['users', ['owner_id'], 'c'],
    ]);
  });

  it('has the keys, uniques and checks of tags and movement_tags', async () => {
    const result = await connection.pool.query<{ conname: string; contype: string }>(
      `select conname, contype::text from pg_constraint
        where conrelid in ('public.tags'::regclass, 'public.movement_tags'::regclass)
          and contype in ('p', 'u', 'c')`,
    );
    const actual = result.rows.map((row) => `${row.conname}:${row.contype}`).sort();
    expect(actual).toEqual(
      [
        'movement_tags_movement_id_position_unique:u',
        'movement_tags_movement_id_tag_id_pk:p',
        'movement_tags_position_check:c',
        'tags_id_owner_unique:u',
        'tags_name_length_check:c',
        'tags_pkey:p',
      ].sort(),
    );
  });

  it('has the case-insensitive unique name index, the prefix index and the tag index', async () => {
    const result = await connection.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public'
        and tablename in ('tags', 'movement_tags')`,
    );
    const defs = Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs['tags_owner_name_unique']).toMatch(/UNIQUE INDEX .*\(owner_id, lower\(name\)\)/);
    expect(defs['tags_owner_name_prefix_idx']).toMatch(
      /\(owner_id, lower\(name\) text_pattern_ops\)/,
    );
    expect(defs['movement_tags_tag_idx']).toMatch(/\(tag_id, movement_id\)/);
  });

  it('stores position as smallint and the name as text', async () => {
    const result = await connection.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and
          ((table_name = 'movement_tags' and column_name = 'position') or (table_name = 'tags' and column_name = 'name'))`,
    );
    const types = Object.fromEntries(result.rows.map((row) => [row.column_name, row.data_type]));
    expect(types).toEqual({ position: 'smallint', name: 'text' });
  });
});
