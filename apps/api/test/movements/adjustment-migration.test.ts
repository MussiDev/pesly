import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0040_balance_adjustments';
const MAIN_MAX_WHEN = 1791830000000;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_adjustment_migration_test`;
  return url.toString();
})();

const HOOK_TIMEOUT_MS = 60_000;

let client: pg.Client;

async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

const fileOf = (relative: string) => readFile(`${migrationsFolder}/${relative}`, 'utf8');

interface Seed {
  ownerId: string;
  accountId: string;
  otherAccountId: string;
  categoryId: string;
}

async function seed(): Promise<Seed> {
  const user = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language)
     values ('adjust@migration.test', 'h', 'UTC', 'es') returning id`,
  );
  const ownerId = user.rows[0]?.id ?? '';
  const accounts = await client.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, 'Cash', 'cash', 'ARS', 1000, true), ($1, 'Bank', 'bank_account', 'ARS', 0, true)
     returning id`,
    [ownerId],
  );
  const category = await client.query<{ id: string }>(
    `insert into categories (owner_id, kind, default_key, icon, color)
     values ($1, 'expense', 'food', 'utensils', '#ff0000') returning id`,
    [ownerId],
  );
  return {
    ownerId,
    accountId: accounts.rows[0]?.id ?? '',
    otherAccountId: accounts.rows[1]?.id ?? '',
    categoryId: category.rows[0]?.id ?? '',
  };
}

async function insertExpense(s: Seed, amount: number): Promise<void> {
  await client.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, 'expense', $2, $3, $4, now(), 10000, 'manual')`,
    [s.ownerId, s.accountId, s.categoryId, amount],
  );
}

function insertAdjustment(
  s: Seed,
  amount: number,
  extra: { category?: boolean; rate?: boolean; destination?: boolean } = {},
): Promise<unknown> {
  return client.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source,
                            destination_account_id, destination_amount)
     values ($1, 'adjustment', $2, $3, $4, now(), $5, $6, $7, $8)`,
    [
      s.ownerId,
      s.accountId,
      extra.category ? s.categoryId : null,
      amount,
      extra.rate ? 10000 : null,
      extra.rate ? 'manual' : null,
      extra.destination ? s.otherAccountId : null,
      extra.destination ? amount : null,
    ],
  );
}

async function adjustmentCount(): Promise<number | null> {
  const result = await client.query("select 1 from movements where type = 'adjustment'");
  return result.rowCount;
}

async function sumOfMovements(): Promise<string> {
  const result = await client.query<{ total: string }>(
    'select coalesce(sum(amount), 0)::text as total from movements',
  );
  return result.rows[0]?.total ?? '';
}

beforeAll(async () => {
  await ensureTestDatabase(throwawayUrl);
  client = new pg.Client({ connectionString: throwawayUrl });
  await client.connect();
  await emptyTheDatabase(client);
  await runMigrations(throwawayUrl);
}, HOOK_TIMEOUT_MS);

// Every test leaves the schema migrated, so only the data is reset between them.
beforeEach(async () => {
  await client.query('truncate table users cascade');
});

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

describe('0040_balance_adjustments migration', () => {
  it('keeps every existing account, movement and computed balance when applied on top of data', async () => {
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const s = await seed();
    await insertExpense(s, 250);
    await insertExpense(s, 125);
    const before = await sumOfMovements();

    await runMigrations(throwawayUrl);

    expect(await sumOfMovements()).toBe(before);
    expect((await client.query('select 1 from movements')).rowCount).toBe(2);
    expect((await client.query('select 1 from accounts')).rowCount).toBe(2);
    const balance = await client.query<{ balance: string }>(
      `select (a.opening_balance - coalesce(sum(m.amount), 0))::text as balance
         from accounts a left join movements m on m.account_id = a.id
        where a.id = $1 group by a.id`,
      [s.accountId],
    );
    expect(balance.rows[0]?.balance).toBe('625');
  });

  it('accepts a bare adjustment of -1 and of 1', async () => {
    const s = await seed();
    await insertAdjustment(s, -1);
    await insertAdjustment(s, 1);

    expect(await adjustmentCount()).toBe(2);
  });

  it('rejects an adjustment of amount 0', async () => {
    const s = await seed();
    await insertAdjustment(s, 1);
    await expect(insertAdjustment(s, 0)).rejects.toMatchObject({
      constraint: 'movements_amount_range_check',
    });
  });

  it('rejects an adjustment whose absolute amount exceeds 10^15', async () => {
    const s = await seed();
    await insertAdjustment(s, -1_000_000_000_000_000);
    await expect(insertAdjustment(s, -1_000_000_000_000_001)).rejects.toMatchObject({
      constraint: 'movements_amount_range_check',
    });
  });

  it.each([
    ['a category', { category: true }],
    ['a rate', { rate: true }],
    ['a destination', { destination: true }],
  ])('rejects an adjustment with %s', async (_label, extra) => {
    const s = await seed();
    await insertAdjustment(s, 5);
    await expect(insertAdjustment(s, 5, extra)).rejects.toMatchObject({
      constraint: 'movements_shape_check',
    });
  });

  it('still rejects a negative amount on a non-adjustment', async () => {
    const s = await seed();
    await expect(insertExpense(s, -5)).rejects.toMatchObject({
      constraint: 'movements_amount_range_check',
    });
  });

  it('rolls back with an adjustment present: raises and deletes nothing', async () => {
    const s = await seed();
    await insertExpense(s, 10);
    await insertAdjustment(s, -3);

    await expect(client.query(await fileOf(`rollback/${TAG}.down.sql`))).rejects.toThrow(
      /adjustment/i,
    );

    expect((await client.query('select 1 from movements')).rowCount).toBe(2);
    expect(await adjustmentCount()).toBe(1);
  });

  it('rolls back with no adjustment, restores the old constraints and re-applies', async () => {
    const s = await seed();
    await insertExpense(s, 10);

    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    // Idempotent: a second run finds nothing to do.
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    // Which restored check fires first is up to PostgreSQL; the type check alone is enough to refuse it.
    await expect(insertAdjustment(s, 5)).rejects.toMatchObject({ code: '23514' });
    expect((await client.query('select 1 from movements')).rowCount).toBe(1);

    await runMigrations(throwawayUrl);
    await insertAdjustment(s, 5);
    expect(await adjustmentCount()).toBe(1);
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBeDefined();
    expect(script).toContain(`"created_at" = ${own?.when}`);
  });

  it('has the greatest journal when, above main, chained to the previous snapshot', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.when).toBeGreaterThan(MAIN_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= (own?.idx ?? 0))
          .map((entry) => entry.when),
      ),
    );
    const snapshot = JSON.parse(
      await fileOf(`meta/${String(own?.idx).padStart(4, '0')}_snapshot.json`),
    ) as { prevId: string };
    const previous = journal.entries
      .filter((entry) => entry.idx < (own?.idx ?? 0))
      .sort((a, b) => b.idx - a.idx)[0];
    const previousSnapshot = JSON.parse(
      await fileOf(`meta/${(previous?.tag ?? '').slice(0, 4)}_snapshot.json`),
    ) as { id: string };
    expect(snapshot.prevId).toBe(previousSnapshot.id);
  });
});
