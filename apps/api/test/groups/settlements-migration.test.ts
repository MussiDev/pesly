import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0028_group_settlements';
const PREVIOUS_WHEN = 1791667061357;
const ADDED_TABLES = ['group_settlement_legs', 'group_settlements'];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_group_settlements_migration_test`;
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

async function addedTables(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1) order by table_name`,
    [ADDED_TABLES],
  );
  return result.rows.map((row) => row.table_name);
}

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
  );
  return Number(result.rows[0]?.n);
}

async function hasLeftAtColumn(): Promise<boolean> {
  const result = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'group_members' and column_name = 'left_at'`,
  );
  return result.rowCount === 1;
}

async function indexDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
    ['public', name],
  );
  return result.rows[0]?.indexdef;
}

async function sqlState(statement: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function one(statement: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(statement, values);
  return result.rows[0]?.id ?? '';
}

const createGroup = () =>
  one("insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id");

const createGhost = (group: string, name = 'Pedro') =>
  one('insert into group_members (group_id, display_name) values ($1, $2) returning id', [
    group,
    name,
  ]);

const createUser = (email: string) =>
  one(
    `insert into users (email, password_hash, time_zone, language)
     values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );

interface Fixture {
  group: string;
  from: string;
  to: string;
}

async function fixture(): Promise<Fixture> {
  const group = await createGroup();
  return { group, from: await createGhost(group, 'Ana'), to: await createGhost(group, 'Beto') };
}

interface SettlementOverrides {
  id?: string;
  from?: string;
  to?: string;
  amount?: string;
  rate?: string | null;
  rateSource?: string | null;
  rateType?: string | null;
  account?: string | null;
  accountMember?: string | null;
}

const insertSettlement = (f: Fixture, o: SettlementOverrides = {}) =>
  sqlState(
    `insert into group_settlements
       (id, group_id, from_member_id, to_member_id, currency, amount, occurred_at,
        created_by_member_id, account_id, account_member_id, rate, rate_source, rate_type)
     values ($1, $2, $3, $4, 'ARS', $5, now(), $3, $6, $7, $8, $9, $10)`,
    [
      o.id ?? randomUUID(),
      f.group,
      o.from ?? f.from,
      o.to ?? f.to,
      o.amount ?? '1000',
      o.account ?? null,
      o.accountMember ?? null,
      o.rate ?? null,
      o.rateSource ?? null,
      o.rateType ?? null,
    ],
  );

describe('0028_group_settlements migration', () => {
  it('applies on an empty database and creates the two tables and the left_at column (NFR-01)', async () => {
    expect(await addedTables()).toEqual(ADDED_TABLES);
    expect(await hasLeftAtColumn()).toBe(true);
    expect(await indexDefinition('group_members_group_user_unique')).toMatch(/left_at IS NULL/);
  });

  it('is reverted by its rollback, which runs twice, touching only what it added, and re-applies', async () => {
    const tablesBefore = await publicTableCount();
    const countBefore = await appliedMigrations();

    // 0030 and 0029 have the greater journal `when`s, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0030_group_activity_log_changes.down.sql'));
    await client.query(await fileOf('rollback/0029_card_automatic_debit.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await addedTables()).toEqual([]);
    expect(await hasLeftAtColumn()).toBe(false);
    expect(await indexDefinition('group_members_group_user_unique')).not.toMatch(/left_at/);
    expect(await indexDefinition('group_members_group_user_unique')).toMatch(/user_id IS NOT NULL/);
    expect(await publicTableCount()).toBe(tablesBefore - ADDED_TABLES.length - 1);
    expect(await appliedMigrations()).toBe(countBefore - 3);
    const group = await createGroup();
    const member = await createGhost(group);
    expect(
      await sqlState(
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         values ($1, $2, 'settlement_created', $3, now())`,
        [group, member, randomUUID()],
      ),
    ).toBe('23514');

    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await addedTables()).toEqual(ADDED_TABLES);
    expect(await hasLeftAtColumn()).toBe(true);
  });

  it('rolls back with an error while a member has left_at set, and leaves everything in place', async () => {
    const group = await createGroup();
    const member = await createGhost(group);
    await client.query('update group_members set left_at = now() where id = $1', [member]);

    expect(await sqlState(await fileOf(`rollback/${TAG}.down.sql`))).toBeDefined();
    expect(await addedTables()).toEqual(ADDED_TABLES);
    expect(await hasLeftAtColumn()).toBe(true);

    await client.query('update group_members set left_at = null where id = $1', [member]);
  });

  it('rejects a settlement of amount 0 without a rate, and the same member on both sides, by the checks (AC-06)', async () => {
    const f = await fixture();

    expect(await insertSettlement(f, { amount: '0' })).toBe('23514');
    expect(await insertSettlement(f, { amount: '-1' })).toBe('23514');
    expect(await insertSettlement(f, { to: f.from })).toBe('23514');
    expect(await insertSettlement(f, { amount: '1' })).toBeUndefined();
    expect(
      await insertSettlement(f, { amount: '0', rate: '10000', rateSource: 'manual' }),
    ).toBeUndefined();
  });

  it('rejects inconsistent rate fields by the checks (AC-13)', async () => {
    const f = await fixture();

    expect(await insertSettlement(f, { rate: '10000' })).toBe('23514');
    expect(await insertSettlement(f, { rateSource: 'manual' })).toBe('23514');
    expect(await insertSettlement(f, { rate: '0', rateSource: 'manual' })).toBe('23514');
    expect(await insertSettlement(f, { rate: '10000', rateSource: 'other' })).toBe('23514');
    expect(
      await insertSettlement(f, { rate: '10000', rateSource: 'manual', rateType: 'blue' }),
    ).toBe('23514');
    expect(
      await insertSettlement(f, { rate: '10000', rateSource: 'automatic', rateType: 'blue' }),
    ).toBeUndefined();
  });

  it('rejects a settlement whose member is of another group by the composite foreign key (AC-07)', async () => {
    const f = await fixture();
    const other = await fixture();

    expect(await insertSettlement(f, { to: other.from })).toBe('23503');
    expect(await insertSettlement(f, { from: other.from })).toBe('23503');
  });

  it('rejects an account member that is neither party of the settlement (AC-08)', async () => {
    const f = await fixture();
    const third = await createGhost(f.group, 'Carla');

    expect(await insertSettlement(f, { accountMember: third })).toBe('23514');
    expect(await insertSettlement(f, { accountMember: f.to })).toBeUndefined();
  });

  it('sets account_id to null when the account is deleted and keeps the settlement (AC-08)', async () => {
    const f = await fixture();
    const user = await createUser('payer@settlements.test');
    const account = await one(
      `insert into accounts (owner_id, name, currency, type, opening_balance, include_in_available)
       values ($1, 'Cash', 'ARS', 'cash', 0, true) returning id`,
      [user],
    );
    const settlement = randomUUID();
    expect(
      await insertSettlement(f, { id: settlement, account, accountMember: f.from }),
    ).toBeUndefined();

    await client.query('delete from accounts where id = $1', [account]);

    const row = await client.query<{ account_id: string | null; account_member_id: string }>(
      'select account_id, account_member_id from group_settlements where id = $1',
      [settlement],
    );
    expect(row.rows).toEqual([{ account_id: null, account_member_id: f.from }]);
  });

  it('lets a user who left be a member of the same group again with a new row (AC-18)', async () => {
    const group = await createGroup();
    const user = await createUser('returning@settlements.test');
    const join = () =>
      sqlState('insert into group_members (group_id, user_id) values ($1, $2)', [group, user]);

    expect(await join()).toBeUndefined();
    expect(await join()).toBe('23505');
    await client.query('update group_members set left_at = now() where group_id = $1', [group]);
    expect(await join()).toBeUndefined();
    expect(await join()).toBe('23505');

    const rows = await client.query('select 1 from group_members where group_id = $1', [group]);
    expect(rows.rowCount).toBe(2);
  });

  it('rejects a duplicate leg row, a zero leg, an unknown currency and a missing settlement as database errors', async () => {
    const f = await fixture();
    const settlement = randomUUID();
    await insertSettlement(f, { id: settlement });
    const insertLeg = (id: string, group: string, amount: string, currency = 'ARS') =>
      sqlState(
        `insert into group_settlement_legs (settlement_id, group_id, currency, amount)
         values ($1, $2, $3, $4)`,
        [id, group, currency, amount],
      );

    expect(await insertLeg(settlement, f.group, '1000')).toBeUndefined();
    expect(await insertLeg(settlement, f.group, '1000')).toBe('23505');
    expect(await insertLeg(settlement, f.group, '0', 'USD')).toBe('23514');
    expect(await insertLeg(settlement, f.group, '5', 'EUR')).toBe('23514');
    expect(await insertLeg(settlement, f.group, '-5', 'USD')).toBeUndefined();
    expect(await insertLeg(randomUUID(), f.group, '5')).toBe('23503');
    const bare = randomUUID();
    await insertSettlement(f, { id: bare });
    expect(await insertLeg(bare, randomUUID(), '5')).toBe('23503');
  });

  it('rejects a foreign key to a missing member as a database error and keeps members with settlements (AC-07)', async () => {
    const f = await fixture();

    expect(await insertSettlement(f, { to: randomUUID() })).toBe('23503');

    const settlement = randomUUID();
    expect(await insertSettlement(f, { id: settlement })).toBeUndefined();
    await client.query(
      `insert into group_settlement_legs (settlement_id, group_id, currency, amount)
       values ($1, $2, 'ARS', 1000)`,
      [settlement, f.group],
    );
    expect(await sqlState('delete from group_members where id = $1', [f.from])).toBe('23503');

    await client.query('delete from group_settlements where id = $1', [settlement]);
    const legs = await client.query(
      'select 1 from group_settlement_legs where settlement_id = $1',
      [settlement],
    );
    expect(legs.rowCount).toBe(0);
  });

  it('accepts the settlement_created log action and rejects an unknown one (AC-22)', async () => {
    const f = await fixture();
    const log = (action: string) =>
      sqlState(
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         values ($1, $2, $3, $4, now())`,
        [f.group, f.from, action, randomUUID()],
      );

    expect(await log('settlement_created')).toBeUndefined();
    expect(await log('expense_created')).toBeUndefined();
    expect(await log('settlement_exported')).toBe('23514');
  });

  it('has the journal entry at idx 28 with a when above 0027, and chains its snapshot onto 0027', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(28);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0028_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0027_snapshot.json')).id,
    );
  });
});
