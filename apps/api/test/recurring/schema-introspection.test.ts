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

const TABLES = ['recurring_occurrences', 'recurring_payments'];

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

describe('recurring schema introspection', () => {
  it('has exactly the two recurring tables (NFR-01)', async () => {
    const result = await connection.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'recurring\\_%' order by table_name`,
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
          and column_name in ('amount', 'confirmed_amount') order by table_name, column_name`,
      [TABLES],
    );
    expect(amounts.rows).toEqual([
      { table_name: 'recurring_occurrences', data_type: 'bigint' },
      { table_name: 'recurring_payments', data_type: 'bigint' },
    ]);
  });

  it('declares the check constraints of the data model', async () => {
    expect(await constraintNames('recurring_payments', 'c')).toEqual([
      'recurring_payments_amount_check',
      'recurring_payments_category_kind_check',
      'recurring_payments_day_of_month_check',
      'recurring_payments_end_after_start_check',
      'recurring_payments_frequency_check',
      'recurring_payments_mode_check',
      'recurring_payments_month_check',
      'recurring_payments_name_length_check',
      'recurring_payments_status_check',
      'recurring_payments_weekday_check',
    ]);
    expect(await constraintNames('recurring_occurrences', 'c')).toEqual([
      'recurring_occurrences_confirmed_amount_check',
      'recurring_occurrences_status_check',
    ]);
  });

  it('declares the unique keys, one occurrence per payment and due date (NFR-03)', async () => {
    expect(await constraintNames('recurring_occurrences', 'u')).toEqual([
      'recurring_occurrences_payment_due_unique',
    ]);
    expect(await constraintNames('recurring_payments', 'u')).toEqual([
      'recurring_payments_id_owner_unique',
    ]);
  });

  it('ties a payment to its owner account and category and cascades from the user (AC-02)', async () => {
    expect(await foreignKeys('recurring_payments')).toEqual([
      {
        conname: 'recurring_payments_account_owner_fk',
        target: 'accounts',
        columns: ['account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'recurring_payments_category_owner_fk',
        target: 'categories',
        columns: ['category_id', 'owner_id', 'category_kind'],
        foreign_columns: ['id', 'owner_id', 'kind'],
        on_delete: 'r',
      },
      {
        conname: 'recurring_payments_owner_id_users_id_fk',
        target: 'users',
        columns: ['owner_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
    ]);
  });

  it('cascades occurrences with their payment and keeps movement_id free of a foreign key (AC-15)', async () => {
    expect(await foreignKeys('recurring_occurrences')).toEqual([
      {
        conname: 'recurring_occurrences_payment_owner_fk',
        target: 'recurring_payments',
        columns: ['payment_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'c',
      },
    ]);
  });

  it('indexes the owner columns that queries filter on', async () => {
    const result = await connection.pool.query<{ indexname: string }>(
      'select indexname from pg_indexes where tablename = any($1) order by indexname',
      [TABLES],
    );
    expect(result.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'recurring_payments_owner_status_idx',
        'recurring_occurrences_owner_status_due_idx',
      ]),
    );
  });
});
