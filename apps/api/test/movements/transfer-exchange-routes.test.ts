import { randomUUID } from 'node:crypto';
import { listMovementsResponseSchema, movementResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createAccountMovements, createMovementRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory } from './db-fixtures';

/** POST /movements for transfers and exchanges (spec 03c, Block 5). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

interface Setup {
  app: Express;
  ana: SessionCookies;
  anaId: string;
  bobId: string;
  clock: MutableClock;
}

async function setup(): Promise<Setup> {
  const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
  const clock = new MutableClock();
  const { db } = connection;
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createAccountRoutes({ db, logger, movements: createAccountMovements(db) }),
      createMovementRoutes({ db, logger, clock }),
    ],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  return { app: harness.app, ana, anaId, bobId, clock };
}

function post(app: Express, body: unknown, cookies: SessionCookies) {
  return request(app)
    .post('/movements')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send(body as object);
}

function getJson(app: Express, path: string, cookies: SessionCookies) {
  return request(app).get(path).set('Cookie', cookieHeader(cookies));
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

interface Accounts {
  ars1: string;
  ars2: string;
  usd1: string;
  usd2: string;
}

async function accountsOf(ownerId: string): Promise<Accounts> {
  const { pool } = connection;
  return {
    ars1: await newAccount(pool, ownerId),
    ars2: await newAccount(pool, ownerId),
    usd1: await newAccount(pool, ownerId, false, 'USD'),
    usd2: await newAccount(pool, ownerId, false, 'USD'),
  };
}

function transfer(
  from: string,
  to: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'transfer',
    accountId: from,
    destinationAccountId: to,
    amount: '5000',
    occurredAt: hoursAgo(1),
    ...overrides,
  };
}

function exchange(
  from: string,
  to: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'exchange',
    accountId: from,
    destinationAccountId: to,
    amount: '155730000',
    destinationAmount: '100000',
    occurredAt: hoursAgo(1),
    ...overrides,
  };
}

async function count(ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from movements where owner_id = $1',
    [ownerId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function balanceOf(s: Setup, id: string): Promise<string> {
  const response = await getJson(s.app, `/accounts/${id}`, s.ana);
  expect(response.status).toBe(200);
  return (response.body as { balance: string }).balance;
}

function without(body: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
}

function fieldsOf(response: { body: unknown }): string[] {
  return (response.body as { fields: string[] }).fields;
}

describe('POST /movements: transfers and exchanges', () => {
  it('saves a transfer and an exchange and lists them with an expense and an income, newest first (AC-01, AC-03, AC-08)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const expenseCategory = await newCategory(connection.pool, s.anaId, 'expense');
    const incomeCategory = await newCategory(connection.pool, s.anaId, 'income');
    const base = {
      accountId: a.ars1,
      amount: '100',
      rate: { source: 'manual', value: '14000000' },
    };
    const expense = await post(
      s.app,
      { ...base, type: 'expense', categoryId: expenseCategory, occurredAt: hoursAgo(5) },
      s.ana,
    );
    expect(expense.status).toBe(201);
    const income = await post(
      s.app,
      { ...base, type: 'income', categoryId: incomeCategory, occurredAt: hoursAgo(4) },
      s.ana,
    );
    expect(income.status).toBe(201);
    const t = await post(
      s.app,
      transfer(a.ars1, a.ars2, { occurredAt: hoursAgo(3), note: ' mine ' }),
      s.ana,
    );
    expect(t.status).toBe(201);
    expect(movementResponseSchema.parse(t.body)).toMatchObject({
      type: 'transfer',
      accountId: a.ars1,
      destinationAccountId: a.ars2,
      amount: '5000',
      destinationAmount: '5000',
      categoryId: null,
      rate: null,
      rateSource: null,
      rateType: null,
      note: 'mine',
    });
    const x = await post(s.app, exchange(a.ars1, a.usd1, { occurredAt: hoursAgo(2) }), s.ana);
    expect(x.status).toBe(201);
    expect(movementResponseSchema.parse(x.body)).toMatchObject({
      type: 'exchange',
      destinationAccountId: a.usd1,
      amount: '155730000',
      destinationAmount: '100000',
      categoryId: null,
      rateType: null,
    });

    const list = listMovementsResponseSchema.parse(
      (await getJson(s.app, '/movements', s.ana)).body,
    );
    expect(list.items.map((item) => item.type)).toEqual([
      'exchange',
      'transfer',
      'income',
      'expense',
    ]);
    const single = await getJson(
      s.app,
      `/movements/${movementResponseSchema.parse(x.body).id}`,
      s.ana,
    );
    expect(movementResponseSchema.parse(single.body).destinationAmount).toBe('100000');
  });

  it('derives the implied rate half-up and ignores a client rate or rateSource (AC-05, AC-14)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const exact = await post(s.app, exchange(a.ars1, a.usd1), s.ana);
    expect(exact.status).toBe(201);
    expect(movementResponseSchema.parse(exact.body)).toMatchObject({
      rate: '15573000',
      rateSource: 'implied',
    });
    const rounded = await post(
      s.app,
      exchange(a.ars1, a.usd1, { amount: '200000', destinationAmount: '300' }),
      s.ana,
    );
    expect(rounded.status).toBe(201);
    expect(movementResponseSchema.parse(rounded.body).rate).toBe('6666667');

    const forgedExchange = await post(
      s.app,
      exchange(a.ars1, a.usd1, {
        rate: { source: 'manual', value: '99999999' },
        rateSource: 'manual',
        rateType: 'blue',
        categoryId: randomUUID(),
      }),
      s.ana,
    );
    expect(forgedExchange.status).toBe(201);
    expect(movementResponseSchema.parse(forgedExchange.body)).toMatchObject({
      rate: '15573000',
      rateSource: 'implied',
      rateType: null,
      categoryId: null,
    });

    const forgedTransfer = await post(
      s.app,
      transfer(a.ars1, a.ars2, {
        rate: { source: 'manual', value: '99999999' },
        rateSource: 'manual',
        destinationAmount: '1',
      }),
      s.ana,
    );
    expect(forgedTransfer.status).toBe(201);
    expect(movementResponseSchema.parse(forgedTransfer.body)).toMatchObject({
      rate: null,
      rateSource: null,
      destinationAmount: '5000',
    });
    const stored = await connection.pool.query<{ rate: string | null; rate_source: string | null }>(
      `select rate::text, rate_source from movements where owner_id = $1 and type = 'transfer'`,
      [s.anaId],
    );
    expect(stored.rows).toEqual([{ rate: null, rate_source: null }]);
  });

  it('answers 400 for the same account, a currency mismatch and an exchange between equal currencies, and stores nothing (AC-02, AC-04)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const same = await post(s.app, transfer(a.ars1, a.ars1), s.ana);
    expect(same.status).toBe(400);
    expect(same.body).toEqual({ code: 'MOVEMENT_SAME_ACCOUNT' });
    const mismatch = await post(s.app, transfer(a.ars1, a.usd1), s.ana);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({ code: 'MOVEMENT_CURRENCY_MISMATCH' });
    const sameCurrency = await post(s.app, exchange(a.ars1, a.ars2), s.ana);
    expect(sameCurrency.status).toBe(400);
    expect(sameCurrency.body).toEqual({ code: 'EXCHANGE_SAME_CURRENCY' });
    const usdPair = await post(s.app, exchange(a.usd1, a.usd2), s.ana);
    expect(usdPair.body).toEqual({ code: 'EXCHANGE_SAME_CURRENCY' });
    expect(await count(s.anaId)).toBe(0);
  });

  it('answers 400 IMPLIED_RATE_OUT_OF_RANGE for an exchange whose rate is out of range and stores nothing (AC-15)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const tooLow = await post(s.app, exchange(a.ars1, a.usd1, { amount: '1' }), s.ana);
    expect(tooLow.status).toBe(400);
    expect(tooLow.body).toEqual({ code: 'IMPLIED_RATE_OUT_OF_RANGE' });
    const tooHigh = await post(
      s.app,
      exchange(a.ars1, a.usd1, { amount: '1000000000000000', destinationAmount: '1' }),
      s.ana,
    );
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body).toEqual({ code: 'IMPLIED_RATE_OUT_OF_RANGE' });
    expect(await count(s.anaId)).toBe(0);
  });

  it('changes the balances by the source and destination amounts after a transfer and an exchange (AC-06)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const t = await post(s.app, transfer(a.ars1, a.ars2, { amount: '4000' }), s.ana);
    expect(t.status).toBe(201);
    expect(await balanceOf(s, a.ars1)).toBe('-4000');
    expect(await balanceOf(s, a.ars2)).toBe('4000');
    const x = await post(
      s.app,
      exchange(a.ars2, a.usd1, { amount: '1000', destinationAmount: '1' }),
      s.ana,
    );
    expect(x.status).toBe(201);
    expect(await balanceOf(s, a.ars2)).toBe('3000');
    expect(await balanceOf(s, a.usd1)).toBe('1');
  });

  it('answers 400 MOVEMENT_DATE_IN_FUTURE for a transfer and an exchange dated after today (AC-07)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const t = await post(s.app, transfer(a.ars1, a.ars2, { occurredAt: future }), s.ana);
    expect(t.status).toBe(400);
    expect(t.body).toEqual({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    const x = await post(s.app, exchange(a.ars1, a.usd1, { occurredAt: future }), s.ana);
    expect(x.status).toBe(400);
    expect(x.body).toEqual({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect(await count(s.anaId)).toBe(0);
  });

  it("answers 404 NOT_FOUND for another user's source or destination and leaves their account untouched (AC-09)", async () => {
    const s = await setup();
    const mine = await accountsOf(s.anaId);
    const theirs = await accountsOf(s.bobId);
    for (const body of [
      transfer(theirs.ars1, mine.ars1),
      transfer(mine.ars1, theirs.ars1),
      exchange(theirs.ars1, mine.usd1),
      exchange(mine.ars1, theirs.usd1),
      transfer(mine.ars1, randomUUID()),
    ]) {
      const response = await post(s.app, body, s.ana);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await count(s.anaId)).toBe(0);
    expect(await count(s.bobId)).toBe(0);
  });

  it('answers 409 ACCOUNT_ARCHIVED for an archived source or destination and works after unarchiving (AC-10)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    for (const id of [a.ars1, a.ars2]) {
      await connection.pool.query('update accounts set archived_at = now() where id = $1', [id]);
      const t = await post(s.app, transfer(a.ars1, a.ars2), s.ana);
      expect(t.status).toBe(409);
      expect(t.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
      await connection.pool.query('update accounts set archived_at = null where id = $1', [id]);
    }
    await connection.pool.query('update accounts set archived_at = now() where id = $1', [a.usd1]);
    const x = await post(s.app, exchange(a.ars1, a.usd1), s.ana);
    expect(x.status).toBe(409);
    expect(x.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    expect(await count(s.anaId)).toBe(0);
    await connection.pool.query('update accounts set archived_at = null where id = $1', [a.usd1]);
    expect((await post(s.app, transfer(a.ars1, a.ars2), s.ana)).status).toBe(201);
    expect((await post(s.app, exchange(a.ars1, a.usd1), s.ana)).status).toBe(201);
  });

  it('answers 400 VALIDATION_FAILED naming the field for an amount above 10^15 and a note above 500 characters (AC-11, AC-12)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const big = await post(s.app, transfer(a.ars1, a.ars2, { amount: '1000000000000001' }), s.ana);
    expect(big.status).toBe(400);
    expect(big.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldsOf(big)).toContain('body.amount');
    const bigDestination = await post(
      s.app,
      exchange(a.ars1, a.usd1, { destinationAmount: '1000000000000001' }),
      s.ana,
    );
    expect(fieldsOf(bigDestination)).toContain('body.destinationAmount');
    const longNote = await post(s.app, exchange(a.ars1, a.usd1, { note: 'x'.repeat(501) }), s.ana);
    expect(longNote.status).toBe(400);
    expect(fieldsOf(longNote)).toContain('body.note');
    const maxNote = await post(s.app, transfer(a.ars1, a.ars2, { note: 'x'.repeat(500) }), s.ana);
    expect(maxNote.status).toBe(201);
    expect(await count(s.anaId)).toBe(1);
  });

  it('answers 400 VALIDATION_FAILED naming body.destinationAmount when an exchange omits it, and body.destinationAccountId when a transfer omits it (FR-02)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const withoutAmount = without(exchange(a.ars1, a.usd1), 'destinationAmount');
    const missingAmount = await post(s.app, withoutAmount, s.ana);
    expect(missingAmount.status).toBe(400);
    expect(missingAmount.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldsOf(missingAmount)).toContain('body.destinationAmount');
    const withoutAccount = without(transfer(a.ars1, a.ars2), 'destinationAccountId');
    const missingAccount = await post(s.app, withoutAccount, s.ana);
    expect(missingAccount.status).toBe(400);
    expect(fieldsOf(missingAccount)).toContain('body.destinationAccountId');
    expect(await count(s.anaId)).toBe(0);
  });

  it('shares the limit of 60 per minute across the four types: the 61st answers 429 with Retry-After, and the next minute accepts again (AC-13)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const category = await newCategory(connection.pool, s.anaId, 'expense');
    const expense = {
      type: 'expense',
      accountId: a.ars1,
      categoryId: category,
      amount: '10',
      occurredAt: hoursAgo(1),
      rate: { source: 'manual', value: '14000000' },
    };
    for (let i = 0; i < 30; i += 1) {
      expect((await post(s.app, expense, s.ana)).status).toBe(201);
    }
    for (let i = 0; i < 30; i += 1) {
      const body =
        i % 2 === 0
          ? transfer(a.ars1, a.ars2, { amount: '10' })
          : exchange(a.ars1, a.usd1, { amount: '1000000', destinationAmount: '1000' });
      expect((await post(s.app, body, s.ana)).status).toBe(201);
    }
    const limited = await post(s.app, transfer(a.ars1, a.ars2), s.ana);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(await count(s.anaId)).toBe(60);
    s.clock.advance(60_000);
    expect((await post(s.app, exchange(a.ars1, a.usd1), s.ana)).status).toBe(201);
    expect(await count(s.anaId)).toBe(61);
  });

  it('refuses a request without a session or without the origin headers (error path)', async () => {
    const s = await setup();
    const a = await accountsOf(s.anaId);
    const anonymous = await request(s.app)
      .post('/movements')
      .set(trustedHeaders)
      .send(transfer(a.ars1, a.ars2));
    expect(anonymous.status).toBe(401);
    const noOrigin = await request(s.app)
      .post('/movements')
      .set('Cookie', cookieHeader(s.ana))
      .send(transfer(a.ars1, a.ars2));
    expect(noOrigin.status).toBe(403);
    expect(await count(s.anaId)).toBe(0);
  });
});
