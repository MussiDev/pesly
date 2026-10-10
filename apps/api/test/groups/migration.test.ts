import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0026_groups';
const PREVIOUS_WHEN = 1791590000000;
const GROUP_TABLES = [
  'group_categories',
  'group_claim_links',
  'group_invitations',
  'group_members',
  'groups',
];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_groups_migration_test`;
  return url.toString();
})();

const HOOK_TIMEOUT_MS = 30_000;

let client: pg.Client;

async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

beforeAll(async () => {
  await ensureTestDatabase(throwawayUrl);
  client = new pg.Client({ connectionString: throwawayUrl });
  await client.connect();
  await emptyTheDatabase(client);
  await runMigrations(throwawayUrl);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

const fileOf = (relative: string) => readFile(`${migrationsFolder}/${relative}`, 'utf8');

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function groupTables(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and (table_name = 'groups' or table_name like 'group\\_%')
      order by table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function sqlState(statement: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function createUser(email: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language)
     values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );
  return result.rows[0]?.id ?? '';
}

async function createGroup(): Promise<string> {
  const result = await client.query<{ id: string }>(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  return result.rows[0]?.id ?? '';
}

const insertMember = (group: string, user: string | null, name: string | null, role = 'member') =>
  sqlState(
    'insert into group_members (group_id, user_id, display_name, role) values ($1, $2, $3, $4)',
    [group, user, name, role],
  );

async function createGhost(group: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into group_members (group_id, display_name) values ($1, 'Pedro') returning id`,
    [group],
  );
  return result.rows[0]?.id ?? '';
}

const hashOf = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('0026_groups migration', () => {
  it('applies on an empty database and creates the five group tables (NFR-01)', async () => {
    expect(await groupTables()).toEqual(GROUP_TABLES);
  });

  it('is reverted by its rollback, which runs twice, touching only the five tables, and re-applies', async () => {
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await groupTables()).toEqual([]);
    expect(await publicTableCount()).toBe(tablesBefore - GROUP_TABLES.length);
    expect(await appliedMigrations()).toBe(countBefore - 1);
    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await groupTables()).toEqual(GROUP_TABLES);
  });

  it('refuses a second membership of the same user in a group, and accepts another group (AC-07)', async () => {
    const user = await createUser('dup@groups.test');
    const group = await createGroup();
    const other = await createGroup();

    expect(await insertMember(group, user, null)).toBeUndefined();
    expect(await insertMember(group, user, null)).toBe('23505');
    expect(await insertMember(other, user, null)).toBeUndefined();
  });

  it('refuses a ghost with the admin role and a member with both or neither of user and name (AC-16)', async () => {
    const user = await createUser('checks@groups.test');
    const group = await createGroup();

    expect(await insertMember(group, null, 'Pedro', 'admin')).toBe('23514');
    expect(await insertMember(group, null, null)).toBe('23514');
    expect(await insertMember(group, user, 'Named', 'member')).toBe('23514');
    expect(await insertMember(group, null, 'Pedro', 'owner')).toBe('23514');
    expect(await insertMember(group, null, 'x'.repeat(51))).toBe('23514');
    expect(await insertMember(group, user, null, 'admin')).toBeUndefined();
  });

  it('refuses a group name outside 1 to 50 characters and an unknown rate type', async () => {
    const insert = (name: string, rate: string) =>
      sqlState('insert into groups (name, default_rate_type) values ($1, $2)', [name, rate]);

    expect(await insert('', 'blue')).toBe('23514');
    expect(await insert('x'.repeat(51), 'blue')).toBe('23514');
    expect(await insert('x'.repeat(50), 'tarjeta')).toBeUndefined();
    expect(await insert('Trip', 'euro')).toBe('23514');
  });

  it('refuses a second unused claim link for a ghost, but allows one after the first is used (AC-11)', async () => {
    const group = await createGroup();
    const ghost = await createGhost(group);
    const insertLink = (used: boolean) =>
      sqlState(
        `insert into group_claim_links (group_id, member_id, token_hash, used_at)
         values ($1, $2, $3, ${used ? 'now()' : 'null'})`,
        [group, ghost, hashOf()],
      );

    expect(await insertLink(false)).toBeUndefined();
    expect(await insertLink(false)).toBe('23505');
    expect(await insertLink(true)).toBeUndefined();
  });

  it('refuses a claim link whose member belongs to another group', async () => {
    const group = await createGroup();
    const other = await createGroup();
    const ghost = await createGhost(group);

    expect(
      await sqlState(
        'insert into group_claim_links (group_id, member_id, token_hash) values ($1, $2, $3)',
        [other, ghost, hashOf()],
      ),
    ).toBe('23503');
  });

  it('refuses a second invitation for the same creating member and a repeated token hash (AC-04)', async () => {
    const user = await createUser('invite@groups.test');
    const group = await createGroup();
    const member = (
      await client.query<{ id: string }>(
        'insert into group_members (group_id, user_id, role) values ($1, $2, $3) returning id',
        [group, user, 'admin'],
      )
    ).rows[0]?.id;
    const insertInvitation = (hash: string) =>
      sqlState(
        `insert into group_invitations (group_id, token_hash, created_by_member_id, expires_at)
         values ($1, $2, $3, now() + interval '7 days')`,
        [group, hash, member],
      );
    const hash = hashOf();

    expect(await insertInvitation(hash)).toBeUndefined();
    expect(await insertInvitation(hashOf())).toBe('23505');
    expect(await insertInvitation(hash)).toBe('23505');
  });

  it('restricts the deletion of a user who is a member, and cascades from group to its rows', async () => {
    const user = await createUser('restrict@groups.test');
    const group = await createGroup();
    await insertMember(group, user, null);
    await createGhost(group);
    await client.query(
      `insert into group_categories (group_id, default_key, icon, color)
       values ($1, 'food', 'utensils', 'red')`,
      [group],
    );

    expect(await sqlState('delete from users where id = $1', [user])).toBe('23503');

    await client.query('delete from groups where id = $1', [group]);
    const left = await client.query<{ n: string }>(
      `select (select count(*) from group_members where group_id = $1)
            + (select count(*) from group_categories where group_id = $1) as n`,
      [group],
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  it('has the journal entry at idx 26 with a when above 0025, and chains its snapshot onto 0025', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(26);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0026_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0025_snapshot.json')).id,
    );
  });
});
