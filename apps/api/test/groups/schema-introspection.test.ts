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
  'group_categories',
  'group_claim_links',
  'group_invitations',
  'group_members',
  'groups',
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

async function constraintNames(type: 'c' | 'u'): Promise<string[]> {
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

describe('groups schema introspection', () => {
  it('has the five tables and no float, real, double, numeric or money column (D14)', async () => {
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

  it('has the check constraints of the data model', async () => {
    expect(await constraintNames('c')).toEqual(
      expect.arrayContaining([
        'groups_name_length_check',
        'groups_default_rate_type_check',
        'group_members_display_name_length_check',
        'group_members_role_check',
        'group_members_user_or_name_check',
        'group_members_not_both_check',
        'group_members_admin_registered_check',
        'group_categories_key_or_name_check',
        'group_categories_name_length_check',
        'group_categories_icon_length_check',
        'group_categories_color_length_check',
      ]),
    );
  });

  it('has the unique constraints and the partial unique indexes', async () => {
    expect(await constraintNames('u')).toEqual(
      expect.arrayContaining([
        'group_members_id_group_unique',
        'group_invitations_token_hash_unique',
        'group_invitations_created_by_member_unique',
        'group_claim_links_token_hash_unique',
      ]),
    );
    const found = await indexes();
    expect(found.group_members_group_user_unique).toMatch(/UNIQUE.*\(group_id, user_id\)/);
    expect(found.group_members_group_user_unique).toMatch(/WHERE \(user_id IS NOT NULL\)/);
    expect(found.group_claim_links_member_unused_unique).toMatch(/UNIQUE.*\(member_id\)/);
    expect(found.group_claim_links_member_unused_unique).toMatch(/WHERE \(used_at IS NULL\)/);
    expect(found.group_categories_group_default_key_unique).toMatch(
      /UNIQUE.*\(group_id, default_key\)/,
    );
    expect(found.group_categories_group_name_unique).toMatch(/UNIQUE.*\(group_id, lower\(name\)\)/);
    expect(found.group_categories_group_name_unique).toMatch(/WHERE \(name IS NOT NULL\)/);
  });

  it('has the list indexes', async () => {
    expect(Object.keys(await indexes())).toEqual(
      expect.arrayContaining([
        'group_members_user_idx',
        'group_members_group_joined_idx',
        'group_invitations_group_idx',
        'group_categories_group_created_idx',
      ]),
    );
  });

  it('restricts the deletion of a user who is a member (D10)', async () => {
    expect(await foreignKeys('group_members')).toEqual([
      {
        conname: 'group_members_group_id_groups_id_fk',
        target: 'groups',
        columns: ['group_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
      {
        conname: 'group_members_user_id_users_id_fk',
        target: 'users',
        columns: ['user_id'],
        foreign_columns: ['id'],
        on_delete: 'r',
      },
    ]);
  });

  it('ties invitations and claim links to a member of the same group and cascades', async () => {
    expect(await foreignKeys('group_invitations')).toEqual([
      {
        conname: 'group_invitations_creator_group_fk',
        target: 'group_members',
        columns: ['created_by_member_id', 'group_id'],
        foreign_columns: ['id', 'group_id'],
        on_delete: 'c',
      },
      {
        conname: 'group_invitations_group_id_groups_id_fk',
        target: 'groups',
        columns: ['group_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
    ]);
    expect(await foreignKeys('group_claim_links')).toEqual([
      {
        conname: 'group_claim_links_group_id_groups_id_fk',
        target: 'groups',
        columns: ['group_id'],
        foreign_columns: ['id'],
        on_delete: 'c',
      },
      {
        conname: 'group_claim_links_member_group_fk',
        target: 'group_members',
        columns: ['member_id', 'group_id'],
        foreign_columns: ['id', 'group_id'],
        on_delete: 'c',
      },
    ]);
    expect((await foreignKeys('group_categories')).map((fk) => fk.on_delete)).toEqual(['c']);
  });
});
