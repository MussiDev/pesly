import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0029_card_automatic_debit';
const PREVIOUS_WHEN = 1791670861757;
const NEW_COLUMNS = [
  'debit_ars_account_id',
  'debit_ars_linked_on',
  'debit_usd_account_id',
  'debit_usd_linked_on',
];

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_automatic_debit_migration_test`;
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

async function cardColumns(): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'credit_cards' order by column_name`,
  );
  return result.rows.map((row) => row.column_name);
}

async function claimTableExists(): Promise<boolean> {
  const result = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'card_automatic_debits'",
  );
  return result.rowCount === 1;
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

async function createAccount(owner: string, currency: 'ARS' | 'USD' = 'ARS'): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, $2, 'cash', $3, 0, true) returning id`,
    [owner, `Caja ${randomUUID()}`, currency],
  );
  return result.rows[0]?.id ?? '';
}

interface Card {
  id: string;
  owner: string;
  ars: string;
  usd: string;
}

async function createCard(owner?: string): Promise<Card> {
  const ownerId = owner ?? (await createUser(`${randomUUID()}@debit.test`));
  const ars = await createAccount(ownerId, 'ARS');
  const usd = await createAccount(ownerId, 'USD');
  const result = await client.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, 'Visa', 10, 20, $2, $3) returning id`,
    [ownerId, ars, usd],
  );
  return { id: result.rows[0]?.id ?? '', owner: ownerId, ars, usd };
}

const setDebit = (card: Card, column: string, linkedColumn: string, account: string | null) =>
  sqlState(`update credit_cards set ${column} = $2, ${linkedColumn} = $3 where id = $1`, [
    card.id,
    account,
    account === null ? null : '2026-10-10',
  ]);

const insertClaim = (
  card: Card,
  fields: {
    period?: string;
    currency?: string;
    status?: string;
    reason?: string | null;
    movement?: string | null;
  },
) =>
  sqlState(
    `insert into card_automatic_debits (card_id, owner_id, period, currency, status, reason, movement_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      card.id,
      card.owner,
      fields.period ?? '2026-10',
      fields.currency ?? 'ARS',
      fields.status ?? 'pending',
      fields.reason ?? null,
      fields.movement ?? null,
    ],
  );

describe('0029_card_automatic_debit migration', () => {
  it('leaves existing cards with no automatic debit when applied after a rollback (AC-01)', async () => {
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const card = await createCard();

    await runMigrations(throwawayUrl);

    const stored = await client.query(
      `select debit_ars_account_id, debit_usd_account_id, debit_ars_linked_on, debit_usd_linked_on
         from credit_cards where id = $1`,
      [card.id],
    );
    expect(stored.rows).toEqual([
      {
        debit_ars_account_id: null,
        debit_usd_account_id: null,
        debit_ars_linked_on: null,
        debit_usd_linked_on: null,
      },
    ]);
  });

  it('accepts a debit account of the owner with its linked date, and refuses one without it', async () => {
    const card = await createCard();
    const debit = await createAccount(card.owner);

    expect(await setDebit(card, 'debit_ars_account_id', 'debit_ars_linked_on', debit)).toBe(
      undefined,
    );
    expect(
      await sqlState('update credit_cards set debit_usd_account_id = $2 where id = $1', [
        card.id,
        debit,
      ]),
    ).toBe('23514');
    expect(
      await sqlState('update credit_cards set debit_ars_linked_on = null where id = $1', [card.id]),
    ).toBe('23514');
  });

  it("refuses a debit account of another owner and one that is the card's own account (AC-05)", async () => {
    const card = await createCard();
    const stranger = await createAccount(await createUser('stranger@debit.test'));

    expect(await setDebit(card, 'debit_ars_account_id', 'debit_ars_linked_on', stranger)).toBe(
      '23503',
    );
    expect(await setDebit(card, 'debit_ars_account_id', 'debit_ars_linked_on', card.ars)).toBe(
      '23514',
    );
    expect(await setDebit(card, 'debit_ars_account_id', 'debit_ars_linked_on', card.usd)).toBe(
      '23514',
    );
    expect(await setDebit(card, 'debit_usd_account_id', 'debit_usd_linked_on', card.ars)).toBe(
      '23514',
    );
    expect(await setDebit(card, 'debit_usd_account_id', 'debit_usd_linked_on', card.usd)).toBe(
      '23514',
    );
  });

  it('lets several cards share one debit account and restricts deleting a debit account (D6, D7)', async () => {
    const first = await createCard();
    const second = await createCard(first.owner);
    const debit = await createAccount(first.owner);

    expect(await setDebit(first, 'debit_ars_account_id', 'debit_ars_linked_on', debit)).toBe(
      undefined,
    );
    expect(await setDebit(second, 'debit_ars_account_id', 'debit_ars_linked_on', debit)).toBe(
      undefined,
    );
    expect(await sqlState('delete from accounts where id = $1', [debit])).toBe('23503');
  });

  it('accepts a claim of each valid status and refuses the inconsistent ones (D1)', async () => {
    const card = await createCard();

    expect(await insertClaim(card, { status: 'pending' })).toBeUndefined();
    expect(
      await insertClaim(card, { period: '2026-09', status: 'recorded', movement: randomUUID() }),
    ).toBeUndefined();
    expect(
      await insertClaim(card, {
        period: '2026-08',
        status: 'skipped',
        reason: 'account_unavailable',
      }),
    ).toBeUndefined();
    expect(await insertClaim(card, { period: '2026-07', status: 'recorded' })).toBe('23514');
    expect(
      await insertClaim(card, {
        period: '2026-07',
        status: 'recorded',
        movement: randomUUID(),
        reason: 'covered',
      }),
    ).toBe('23514');
    expect(await insertClaim(card, { period: '2026-07', status: 'skipped' })).toBe('23514');
    expect(
      await insertClaim(card, {
        period: '2026-07',
        status: 'skipped',
        reason: 'covered',
        movement: randomUUID(),
      }),
    ).toBe('23514');
    expect(
      await insertClaim(card, { period: '2026-07', status: 'pending', reason: 'covered' }),
    ).toBe('23514');
    expect(await insertClaim(card, { period: '2026-07', status: 'done' })).toBe('23514');
    expect(await insertClaim(card, { period: '2026-07', status: 'skipped', reason: 'other' })).toBe(
      '23514',
    );
  });

  it('refuses a malformed period and a currency outside ARS and USD', async () => {
    const card = await createCard();

    expect(await insertClaim(card, { period: '2026-13' })).toBe('23514');
    expect(await insertClaim(card, { period: '2026-1' })).toBe('23514');
    expect(await insertClaim(card, { currency: 'EUR' })).toBe('23514');
    expect(await insertClaim(card, { period: '2026-12', currency: 'USD' })).toBeUndefined();
  });

  it('refuses the same (card, period, currency) twice and accepts another currency (NFR-03)', async () => {
    const card = await createCard();

    expect(await insertClaim(card, {})).toBeUndefined();
    expect(await insertClaim(card, {})).toBe('23505');
    expect(await insertClaim(card, { currency: 'USD' })).toBeUndefined();
  });

  it('refuses a claim whose card belongs to another owner, and cascades with the card', async () => {
    const card = await createCard();
    const stranger = await createUser('claim-stranger@debit.test');

    expect(
      await sqlState(
        `insert into card_automatic_debits (card_id, owner_id, period, currency, status)
         values ($1, $2, '2026-10', 'ARS', 'pending')`,
        [card.id, stranger],
      ),
    ).toBe('23503');

    await insertClaim(card, {});
    await client.query('delete from credit_cards where id = $1', [card.id]);
    const left = await client.query('select 1 from card_automatic_debits where card_id = $1', [
      card.id,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it('keeps the claim when the transfer it recorded is gone: movement_id has no foreign key', async () => {
    const result = await client.query(
      `select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
        where c.contype = 'f' and t.relname = 'card_automatic_debits' and c.conname <> 'card_automatic_debits_card_owner_fk'`,
    );
    expect(result.rowCount).toBe(0);
  });

  it('is reverted by its rollback, which runs twice, restoring the 0028 schema, and re-applies', async () => {
    const before = await cardColumns();
    const countBefore = await appliedMigrations();

    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await cardColumns()).toEqual(before.filter((name) => !NEW_COLUMNS.includes(name)));
    expect(await claimTableExists()).toBe(false);
    expect(await appliedMigrations()).toBe(countBefore - 1);
    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await cardColumns()).toEqual(before);
    expect(await claimTableExists()).toBe(true);
  });

  it('has the journal entry at idx 29 with a when above 0028, and chains its snapshot onto 0028', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(29);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect((await read<{ prevId: string }>('0029_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0028_snapshot.json')).id,
    );
  });
});
