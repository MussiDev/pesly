import { dashboardResponseSchema, type DashboardResponse } from '@pesly/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleAccountRepository, ListAccounts } from '../../src/accounts';
import { buildAvailable } from '../../src/dashboard/application/build-available';
import type { DashboardContext } from '../../src/dashboard/application/dashboard-context';
import { createAccountMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { readScope } from '../movements/db-fixtures';
import { addRealUser, buildRealApp, getJson } from './real-app';
import { seedRate, seedWorld } from './world-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const ME = '11111111-1111-4111-8111-111111111111';

function context(displayCurrency: 'ARS' | 'USD' = 'ARS'): DashboardContext {
  return {
    preferences: {
      displayCurrency,
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    today: '2026-10-06',
    month: '2026-10',
    monthStart: '2026-10-01',
    userId: ME,
  };
}

function listing(ars: bigint, usd: bigint) {
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      accounts: {
        execute: (scope: unknown) => {
          calls.push(scope);
          return Promise.resolve({ ARS: ars, USD: usd });
        },
      },
    },
  };
}

describe('buildAvailable', () => {
  it('(AC-18) returns the two parts of the accounts totals', async () => {
    const { deps, calls } = listing(10_000_000n, 5_000n);

    const scope = await readScope(ME);

    const section = await buildAvailable(deps, scope, context(), Promise.resolve(null));

    expect(section).toMatchObject({ ars: 10_000_000n, usd: 5_000n });
    expect(calls).toEqual([scope]);
  });

  it('(AC-20) converts the USD part with the rate the net worth read', async () => {
    const { deps } = listing(10_000_000n, 5_000n);

    const section = await buildAvailable(
      deps,
      await readScope(ME),
      context(),
      Promise.resolve(15_000_000n),
    );

    expect(section.total).toBe(10_000_000n + 7_500_000n);
    expect(section.reason).toBeNull();
  });

  it('(AC-21) without a rate gives total null, the reason and the two parts', async () => {
    const { deps } = listing(10_000_000n, 5_000n);

    const section = await buildAvailable(
      deps,
      await readScope(ME),
      context(),
      Promise.resolve(null),
    );

    expect(section).toEqual({ ars: 10_000_000n, usd: 5_000n, total: null, reason: 'no_rate' });
  });

  it('(AC-21) without a rate and a zero USD part the ARS part is the total', async () => {
    const { deps } = listing(300n, 0n);

    const section = await buildAvailable(
      deps,
      await readScope(ME),
      context(),
      Promise.resolve(null),
    );

    expect(section).toEqual({ ars: 300n, usd: 0n, total: 300n, reason: null });
  });

  it('does not swallow an accounts read error', async () => {
    const deps = { accounts: { execute: () => Promise.reject(new Error('accounts down')) } };

    await expect(
      buildAvailable(deps, await readScope(ME), context(), Promise.resolve(15_000_000n)),
    ).rejects.toThrow('accounts down');
  });
});

async function insertAccount(
  pool: pg.Pool,
  owner: string,
  name: string,
  currency: 'ARS' | 'USD',
  opening: bigint,
  options: { type?: string; include?: boolean; archived?: boolean } = {},
): Promise<void> {
  await pool.query(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available, archived_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      owner,
      name,
      options.type ?? 'bank_account',
      currency,
      opening.toString(),
      options.include ?? true,
      options.archived ? new Date() : null,
    ],
  );
}

async function dashboardOf(
  app: Parameters<typeof getJson>[0],
  cookies: Parameters<typeof getJson>[2],
): Promise<DashboardResponse> {
  const response = await getJson(app, '/dashboard', cookies);
  expect(response.status).toBe(200);
  return dashboardResponseSchema.parse(response.body);
}

describe('the available section over the real routes and PostgreSQL', () => {
  it('(AC-18, AC-20) 100,000.00 ARS in a bank and 50.00 USD in a wallet, converted at the stored rate', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await insertAccount(connection.pool, ana.id, 'Bank', 'ARS', 10_000_000n);
    await insertAccount(connection.pool, ana.id, 'Wallet', 'USD', 5_000n, {
      type: 'digital_wallet',
    });

    const body = await dashboardOf(app, ana.cookies);

    expect(body.available).toEqual({
      ars: '10000000',
      usd: '5000',
      total: '17000000',
      reason: null,
    });
  });

  it('(AC-19) equals the available totals of ListAccounts for the same data', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await seedWorld(connection, ana.id, 'ana');
    const list = new ListAccounts({
      accounts: new DrizzleAccountRepository(connection.db),
      movements: createAccountMovements(connection.db),
    });

    const { availableTotals } = await list.execute(await readScope(ana.id), {
      archived: false,
      limit: 1,
      offset: 0,
    });
    const body = await dashboardOf(app, ana.cookies);

    expect(body.available.ars).toBe(availableTotals.ARS.toString());
    expect(body.available.usd).toBe(availableTotals.USD.toString());
    expect(body.available.ars).toBe('19600000');
    expect(body.available.usd).toBe('98000');
  });

  it('(AC-22) an archived account and one not marked include-in-available add 0', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await insertAccount(connection.pool, ana.id, 'Bank', 'ARS', 1_000n);
    await insertAccount(connection.pool, ana.id, 'Old', 'ARS', 5_000_000n, { archived: true });
    await insertAccount(connection.pool, ana.id, 'Savings', 'ARS', 7_000_000n, {
      type: 'savings',
      include: false,
    });

    const body = await dashboardOf(app, ana.cookies);

    expect(body.available.ars).toBe('1000');
  });

  it('(AC-23) a credit card with debt and an investment portfolio do not change it', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await insertAccount(connection.pool, ana.id, 'Bank', 'ARS', 1_000n);
    const before = await dashboardOf(app, ana.cookies);

    await insertAccount(connection.pool, ana.id, 'Card', 'ARS', -9_000_000n, {
      type: 'credit_card',
      include: false,
    });
    const portfolio = await connection.pool.query<{ id: string }>(
      'insert into portfolios (owner_id, name) values ($1, $2) returning id',
      [ana.id, 'broker'],
    );
    await connection.pool.query(
      `insert into holdings (portfolio_id, owner_id, ticker, instrument_name, instrument_type, quantity,
                             valuation_currency, total_cost, unit_price, price_source, priced_at)
       values ($1, $2, 'AAA', 'Priced', 'stock', 200000000, 'ARS', 1000000, 150000, 'manual', now())`,
      [portfolio.rows[0]?.id, ana.id],
    );
    const after = await dashboardOf(app, ana.cookies);

    expect(after.available).toEqual(before.available);
    expect(after.available.ars).toBe('1000');
    expect(after.netWorth.ars).not.toBe(before.netWorth.ars);
  });

  it("(AC-24) another user's included account never counts", async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const bea = await addRealUser(connection, app, 'bea');
    await insertAccount(connection.pool, ana.id, 'Bank', 'ARS', 1_000n);
    await insertAccount(connection.pool, bea.id, 'Bank', 'ARS', 9_999_000n);
    await insertAccount(connection.pool, bea.id, 'Wallet', 'USD', 9_999n);

    const body = await dashboardOf(app, ana.cookies);

    expect(body.available.ars).toBe('1000');
    expect(body.available.usd).toBe('0');
  });
});
