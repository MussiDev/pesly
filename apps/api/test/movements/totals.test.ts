import { randomUUID } from 'node:crypto';
import { accountResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory } from './db-fixtures';
import {
  get,
  movementBody,
  obligationsSetup,
  send,
  type ObligationsSetup,
} from './obligations-harness';

/** FEAT-003 Available and Net worth totals with real movements (spec 03b, Block 7). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Totals {
  available: bigint;
  netWorth: bigint;
}

async function totals(s: ObligationsSetup, cookies = s.ana): Promise<Totals> {
  const response = await get(s.app, '/accounts?limit=100', cookies);
  expect(response.status).toBe(200);
  const body = response.body as {
    availableTotals: { ARS: string };
    netWorthTotals: { ARS: string };
  };
  return {
    available: BigInt(body.availableTotals.ARS),
    netWorth: BigInt(body.netWorthTotals.ARS),
  };
}

async function createAccount(
  s: ObligationsSetup,
  includeInAvailable: boolean,
  openingBalance: string,
  currency: 'ARS' | 'USD' = 'ARS',
): Promise<string> {
  const response = await send(s.app, 'post', '/accounts', s.ana, {
    name: `Cuenta ${randomUUID()}`,
    type: 'cash',
    currency,
    openingBalance,
    includeInAvailable,
  });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

async function record(
  s: ObligationsSetup,
  type: 'expense' | 'income',
  accountId: string,
  categoryId: string,
  amount: string,
  cookies = s.ana,
): Promise<void> {
  const response = await send(
    s.app,
    'post',
    '/movements',
    cookies,
    movementBody({ type, accountId, categoryId, amount }),
  );
  expect(response.status).toBe(201);
}

async function usdTotals(s: ObligationsSetup): Promise<Totals> {
  const response = await get(s.app, '/accounts?limit=100', s.ana);
  const body = response.body as {
    availableTotals: Record<string, string | undefined>;
    netWorthTotals: Record<string, string | undefined>;
  };
  return {
    available: BigInt(body.availableTotals.USD ?? '0'),
    netWorth: BigInt(body.netWorthTotals.USD ?? '0'),
  };
}

describe('Available and Net worth with transfers and exchanges', () => {
  it('a transfer from an included to a non-included account lowers Available by the amount and leaves Net worth unchanged (AC-06)', async () => {
    const s = await obligationsSetup(connection);
    const included = await createAccount(s, true, '50000');
    const excluded = await createAccount(s, false, '20000');
    expect(await totals(s)).toEqual({ available: 50000n, netWorth: 70000n });

    const response = await send(s.app, 'post', '/movements', s.ana, {
      type: 'transfer',
      accountId: included,
      destinationAccountId: excluded,
      amount: '12000',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    expect(await totals(s)).toEqual({ available: 38000n, netWorth: 70000n });

    const back = await send(s.app, 'post', '/movements', s.ana, {
      type: 'transfer',
      accountId: excluded,
      destinationAccountId: included,
      amount: '2000',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(back.status).toBe(201);
    expect(await totals(s)).toEqual({ available: 40000n, netWorth: 70000n });
  });

  it('a transfer between two included accounts leaves Available unchanged (AC-06)', async () => {
    const s = await obligationsSetup(connection);
    const one = await createAccount(s, true, '50000');
    const two = await createAccount(s, true, '1000');
    const response = await send(s.app, 'post', '/movements', s.ana, {
      type: 'transfer',
      accountId: one,
      destinationAccountId: two,
      amount: '7000',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    expect(await totals(s)).toEqual({ available: 51000n, netWorth: 51000n });
  });

  it('an exchange moves each currency total by its own side only (AC-06)', async () => {
    const s = await obligationsSetup(connection);
    const ars = await createAccount(s, true, '20000000');
    const usd = await createAccount(s, true, '0', 'USD');
    const response = await send(s.app, 'post', '/movements', s.ana, {
      type: 'exchange',
      accountId: ars,
      destinationAccountId: usd,
      amount: '15573000',
      destinationAmount: '100000',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    expect(await totals(s)).toEqual({ available: 4427000n, netWorth: 4427000n });
    expect(await usdTotals(s)).toEqual({ available: 100000n, netWorth: 100000n });
  });

  it('an exchange into a non-included USD account lowers ARS Available and raises only USD Net worth (AC-06)', async () => {
    const s = await obligationsSetup(connection);
    const ars = await createAccount(s, true, '1000000');
    const usd = await createAccount(s, false, '0', 'USD');
    const response = await send(s.app, 'post', '/movements', s.ana, {
      type: 'exchange',
      accountId: ars,
      destinationAccountId: usd,
      amount: '300000',
      destinationAmount: '200',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    expect(await totals(s)).toEqual({ available: 700000n, netWorth: 700000n });
    expect(await usdTotals(s)).toEqual({ available: 0n, netWorth: 200n });
  });
});

describe('Available and Net worth with real movements', () => {
  it('an expense of 100.00 lowers both, an income raises both, a non-included account moves only Net worth (AC-24, AC-12, AC-13)', async () => {
    const s = await obligationsSetup(connection);
    const included = await createAccount(s, true, '50000');
    const excluded = await createAccount(s, false, '20000');
    const expense = await newCategory(connection.pool, s.anaId, 'expense');
    const income = await newCategory(connection.pool, s.anaId, 'income');
    expect(await totals(s)).toEqual({ available: 50000n, netWorth: 70000n });

    await record(s, 'expense', included, expense, '10000');
    expect(await totals(s)).toEqual({ available: 40000n, netWorth: 60000n });

    await record(s, 'income', included, income, '25000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 85000n });

    await record(s, 'expense', excluded, expense, '10000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 75000n });

    await record(s, 'income', excluded, income, '3000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 78000n });
  });

  it("a second user's movements never change the caller's totals (AC-13)", async () => {
    const s = await obligationsSetup(connection);
    await createAccount(s, true, '1000');
    const bobAccountResponse = await send(s.app, 'post', '/accounts', s.bob, {
      name: 'Bob',
      type: 'cash',
      currency: 'ARS',
      openingBalance: '0',
    });
    const bobAccount = accountResponseSchema.parse(bobAccountResponse.body).id;
    const bobCategory = await newCategory(connection.pool, s.bobId, 'income');
    const before = await totals(s);

    await record(s, 'income', bobAccount, bobCategory, '777777', s.bob);

    expect(await totals(s)).toEqual(before);
    expect(before).toEqual({ available: 1000n, netWorth: 1000n });
  });
});
