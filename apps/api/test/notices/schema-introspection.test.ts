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

const indexes = async (): Promise<{ indexname: string; indexdef: string }[]> =>
  (
    await connection.pool.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'notices' order by indexname",
    )
  ).rows;

describe('notices schema introspection (NFR-04)', () => {
  it('has the columns of the data model with the declared types, nullability and defaults', async () => {
    const result = await connection.pool.query(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'notices' order by column_name`,
    );

    expect(result.rows).toEqual([
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      { column_name: 'due_date', data_type: 'date', is_nullable: 'NO', column_default: null },
      {
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        column_default: 'gen_random_uuid()',
      },
      { column_name: 'kind', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'owner_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'payment_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      {
        column_name: 'read_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
      { column_name: 'text', data_type: 'text', is_nullable: 'NO', column_default: null },
    ]);
  });

  it('declares the owner foreign key with cascade and no foreign key on payment_id', async () => {
    const result = await connection.pool.query(
      `select c.conname, f.relname as target, c.confdeltype as on_delete,
              (select array_agg(a.attname::text) from unnest(c.conkey) k(attnum)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_class f on f.oid = c.confrelid
        where c.contype = 'f' and t.relname = 'notices'`,
    );

    expect(result.rows).toEqual([
      {
        conname: 'notices_owner_id_users_id_fk',
        target: 'users',
        on_delete: 'c',
        columns: ['owner_id'],
      },
    ]);
  });

  it('declares the check and unique constraints', async () => {
    const result = await connection.pool.query(
      `select c.conname, c.contype from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname = 'notices' and c.contype in ('c', 'u') order by c.conname`,
    );

    expect(result.rows).toEqual([
      { conname: 'notices_kind_check', contype: 'c' },
      { conname: 'notices_kind_payment_due_unique', contype: 'u' },
      { conname: 'notices_text_length_check', contype: 'c' },
    ]);
  });

  it('declares the owner feed index, newest first, and the partial unread index', async () => {
    const found = await indexes();
    const byName = new Map(found.map((entry) => [entry.indexname, entry.indexdef]));

    expect(byName.get('notices_owner_created_idx')).toMatch(
      /\(owner_id, created_at DESC NULLS LAST, id DESC NULLS LAST\)/,
    );
    expect(byName.get('notices_owner_unread_idx')).toMatch(
      /\(owner_id\) WHERE \(read_at IS NULL\)/,
    );
    expect(byName.has('notices_kind_payment_due_unique')).toBe(true);
  });

  it('adds reminder_days to recurring_payments as a not null smallint defaulting to 3', async () => {
    const result = await connection.pool.query(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'recurring_payments'
          and column_name = 'reminder_days'`,
    );

    expect(result.rows).toEqual([
      { data_type: 'smallint', is_nullable: 'NO', column_default: '3' },
    ]);
  });
});
