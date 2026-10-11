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

const TABLES = ['credit_card_statements', 'credit_cards'];
const INSTALLMENT_TABLES = ['installment_purchases', 'installments'];

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

describe('credit cards schema introspection', () => {
  it('has no float, real, double, numeric or money column (NFR-01)', async () => {
    const result = await connection.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [[...TABLES, ...INSTALLMENT_TABLES]],
    );
    expect(result.rows).toEqual([]);
  });

  it('adds no table beyond the two card tables (10b NFR-01)', async () => {
    const result = await connection.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'credit\\_card%' order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(TABLES.toSorted());
  });

  it('ties both linked accounts to the card owner with restricting composite keys (FR-02, AC-10)', async () => {
    expect(await foreignKeys('credit_cards')).toEqual([
      {
        conname: 'credit_cards_ars_account_owner_fk',
        target: 'accounts',
        columns: ['ars_account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'credit_cards_debit_ars_account_owner_fk',
        target: 'accounts',
        columns: ['debit_ars_account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'credit_cards_debit_usd_account_owner_fk',
        target: 'accounts',
        columns: ['debit_usd_account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'credit_cards_owner_id_users_id_fk',
        target: 'users',
        columns: ['owner_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
      {
        conname: 'credit_cards_usd_account_owner_fk',
        target: 'accounts',
        columns: ['usd_account_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
    ]);
  });

  it('ties every statement to its card and owner and cascades with the card (FR-08)', async () => {
    expect(await foreignKeys('credit_card_statements')).toEqual([
      {
        conname: 'credit_card_statements_card_owner_fk',
        target: 'credit_cards',
        columns: ['card_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'c',
      },
    ]);
  });

  it('indexes the owner columns that list queries filter on', async () => {
    const result = await connection.pool.query<{ indexname: string }>(
      'select indexname from pg_indexes where tablename = any($1) order by indexname',
      [TABLES],
    );
    expect(result.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'credit_cards_owner_created_idx',
        'credit_card_statements_owner_idx',
        'credit_card_statements_card_closing_idx',
        'credit_card_statements_card_period_unique',
      ]),
    );
  });

  it('ties every automatic debit claim to its card and owner, cascading, with no key to movements (10e FR-02)', async () => {
    expect(await foreignKeys('card_automatic_debits')).toEqual([
      {
        conname: 'card_automatic_debits_card_owner_fk',
        target: 'credit_cards',
        columns: ['card_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'c',
      },
    ]);
  });

  it('names the automatic debit checks, primary key and indexes (10e FR-01, NFR-03)', async () => {
    const constraints = await connection.pool.query<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname in ('credit_cards', 'card_automatic_debits') and c.contype in ('c', 'p')
        order by c.conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        'credit_cards_debit_ars_linked_check',
        'credit_cards_debit_usd_linked_check',
        'credit_cards_debit_ars_not_card_account_check',
        'credit_cards_debit_usd_not_card_account_check',
        'card_automatic_debits_pk',
        'card_automatic_debits_period_check',
        'card_automatic_debits_currency_check',
        'card_automatic_debits_status_check',
        'card_automatic_debits_reason_check',
        'card_automatic_debits_state_check',
      ]),
    );
    const indexes = await connection.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where tablename in ('credit_cards', 'card_automatic_debits')
          and indexname in ('credit_cards_automatic_debit_idx', 'card_automatic_debits_owner_idx')
        order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'card_automatic_debits_owner_idx',
      'credit_cards_automatic_debit_idx',
    ]);
    expect(indexes.rows[1]?.indexdef).toMatch(/WHERE/);
  });

  it('has no unique constraint on the debit columns, so cards can share an account (10e D6)', async () => {
    const result = await connection.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where tablename = 'credit_cards' and indexdef ilike '%unique%' and indexdef ilike '%debit%'`,
    );
    expect(result.rows).toEqual([]);
  });

  it('stores the debit link dates as date and the claim has no amount or float column (10e NFR-01)', async () => {
    const result = await connection.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'credit_cards' and column_name like 'debit\\_%'
        order by column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: 'debit_ars_account_id', data_type: 'uuid' },
      { column_name: 'debit_ars_linked_on', data_type: 'date' },
      { column_name: 'debit_usd_account_id', data_type: 'uuid' },
      { column_name: 'debit_usd_linked_on', data_type: 'date' },
    ]);
    const floats = await connection.pool.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'card_automatic_debits'
          and data_type in ('real', 'double precision', 'numeric', 'money', 'bigint')`,
    );
    expect(floats.rowCount).toBe(0);
  });

  it('stores installment amounts as bigint and ties purchases to their card, owner and category (10c NFR-01)', async () => {
    const amounts = await connection.pool.query<{ table_name: string; data_type: string }>(
      `select table_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = any($1) and column_name in ('total_amount', 'amount')
        order by table_name`,
      [INSTALLMENT_TABLES],
    );
    expect(amounts.rows).toEqual([
      { table_name: 'installment_purchases', data_type: 'bigint' },
      { table_name: 'installments', data_type: 'bigint' },
    ]);
    expect(await foreignKeys('installment_purchases')).toEqual([
      {
        conname: 'installment_purchases_card_owner_fk',
        target: 'credit_cards',
        columns: ['card_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'r',
      },
      {
        conname: 'installment_purchases_category_owner_kind_fk',
        target: 'categories',
        columns: ['category_id', 'owner_id', 'category_kind'],
        foreign_columns: ['id', 'owner_id', 'kind'],
        on_delete: 'r',
      },
      {
        conname: 'installment_purchases_owner_id_users_id_fk',
        target: 'users',
        columns: ['owner_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
    ]);
    expect(await foreignKeys('installments')).toEqual([
      {
        conname: 'installments_purchase_owner_fk',
        target: 'installment_purchases',
        columns: ['purchase_id', 'owner_id'],
        foreign_columns: ['id', 'owner_id'],
        on_delete: 'c',
      },
    ]);
  });
});
