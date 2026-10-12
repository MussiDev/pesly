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
  'budgets',
  'budget_versions',
  'budget_version_categories',
  'budget_version_thresholds',
  'budget_alert_marks',
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
    `select c.conname, f.relname as target,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as foreign_columns,
            c.confdeltype as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class f on f.oid = c.confrelid
      where c.contype = 'f' and t.relname = $1 order by c.conname`,
    [table],
  );
  return result.rows;
}

async function constraintDefs(table: string, type: 'c' | 'u' | 'p'): Promise<string[]> {
  const result = await connection.pool.query<{ def: string }>(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where t.relname = $1 and c.contype = $2 order by 1`,
    [table, type],
  );
  return result.rows.map((row) => row.def);
}

const shape = (keys: ForeignKey[]) =>
  keys.map(
    (k) => `${k.columns.join(',')}->${k.target}(${k.foreign_columns.join(',')}):${k.on_delete}`,
  );

describe('budgets schema introspection', () => {
  it('has the four tables and no real, double, numeric or money column (NFR-01)', async () => {
    const tables = await connection.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'budget%' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([...TABLES].sort());

    const floats = await connection.pool.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [TABLES],
    );
    expect(floats.rows).toEqual([]);
  });

  it('stores the amount as bigint, the date as date and the percent as smallint', async () => {
    const result = await connection.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'budget_versions' and column_name in ('amount', 'effective_from'))
            or (table_name = 'budget_version_thresholds' and column_name = 'percent'))
        order by column_name`,
    );
    expect(result.rows.map((row) => `${row.column_name}:${row.data_type}`)).toEqual([
      'amount:bigint',
      'effective_from:date',
      'percent:smallint',
    ]);
  });

  it('has the checks', async () => {
    expect((await constraintDefs('budgets', 'c')).join('\n')).toContain("'ARS'");
    const versions = (await constraintDefs('budget_versions', 'c')).join('\n');
    expect(versions).toMatch(/EXTRACT\(day FROM effective_from\)/i);
    expect(versions).toContain('char_length(name)');
    expect(versions).toMatch(/amount > 0/);
    expect((await constraintDefs('budget_version_categories', 'c')).join('\n')).toContain(
      "'expense'",
    );
    expect((await constraintDefs('budget_version_thresholds', 'c')).join('\n')).toContain(
      'percent',
    );
  });

  it('has the unique constraints and primary keys', async () => {
    expect(await constraintDefs('budgets', 'u')).toEqual(['UNIQUE (id, owner_id)']);
    expect(await constraintDefs('budget_versions', 'u')).toEqual([
      'UNIQUE (budget_id, effective_from)',
      'UNIQUE (id, owner_id)',
    ]);
    expect(await constraintDefs('budget_version_categories', 'p')).toEqual([
      'PRIMARY KEY (version_id, category_id)',
    ]);
    expect(await constraintDefs('budget_version_thresholds', 'p')).toEqual([
      'PRIMARY KEY (version_id, percent)',
    ]);
  });

  it('has the composite keys with their delete actions', async () => {
    expect(shape(await foreignKeys('budgets'))).toEqual(['owner_id->users(id):c']);
    expect(shape(await foreignKeys('budget_versions'))).toEqual([
      'budget_id,owner_id->budgets(id,owner_id):c',
    ]);
    expect(shape(await foreignKeys('budget_version_categories')).sort()).toEqual(
      [
        'version_id,owner_id->budget_versions(id,owner_id):c',
        'category_id,owner_id,kind->categories(id,owner_id,kind):a',
      ].sort(),
    );
    expect(shape(await foreignKeys('budget_version_thresholds'))).toEqual([
      'version_id,owner_id->budget_versions(id,owner_id):c',
    ]);
  });

  it('defers only the category key, so account erasure can delete both sides (D4, D10)', async () => {
    const result = await connection.pool.query<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
        where c.contype = 'f' and t.relname like 'budget%' and c.condeferrable and c.condeferred`,
    );
    expect(result.rows.map((row) => row.conname)).toEqual([
      'budget_version_categories_category_owner_kind_fk',
    ]);
  });

  it('has the list and category lookup indexes', async () => {
    const result = await connection.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename like 'budget%'`,
    );
    const defs = result.rows.map((row) => row.indexdef).join('\n');
    expect(defs).toContain('(owner_id, created_at, id)');
    expect(defs).toContain('ON public.budget_version_categories USING btree (category_id)');
  });
});
