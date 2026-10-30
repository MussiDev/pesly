import { randomUUID } from 'node:crypto';
import { movementSummaryResponseSchema, type MovementSummaryRow } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
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
  bob: SessionCookies;
  bobId: string;
}

async function setup(): Promise<Setup> {
  const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createMovementRoutes({ db: connection.db, logger })],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, ana, anaId, bob, bobId };
}

function get(app: Express, path: string, cookies?: SessionCookies) {
  const call = request(app).get(path);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

async function create(app: Express, cookies: SessionCookies, body: Record<string, unknown>) {
  const response = await request(app)
    .post('/movements')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send(body);
  expect(response.status).toBe(201);
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const MANUAL_RATE = { source: 'manual', value: '14000000' };

function byKey(rows: readonly MovementSummaryRow[]): Map<string, MovementSummaryRow> {
  return new Map(rows.map((row) => [`${row.categoryId}|${row.currency}|${row.type}`, row]));
}

describe('GET /movements/summary', () => {
  it('sums the expenses and incomes by category and currency, leaving transfers out', async () => {
    const s = await setup();
    const ars = await newAccount(connection.pool, s.anaId);
    const otherArs = await newAccount(connection.pool, s.anaId);
    const usd = await newAccount(connection.pool, s.anaId, false, 'USD');
    const food = await newCategory(connection.pool, s.anaId, 'expense');
    const salary = await newCategory(connection.pool, s.anaId, 'income');
    const expense = { type: 'expense', categoryId: food, rate: MANUAL_RATE };
    await create(s.app, s.ana, {
      ...expense,
      accountId: ars,
      amount: '150000',
      occurredAt: hoursAgo(1),
    });
    await create(s.app, s.ana, {
      ...expense,
      accountId: ars,
      amount: '50000',
      occurredAt: hoursAgo(2),
    });
    await create(s.app, s.ana, {
      ...expense,
      accountId: usd,
      amount: '1200',
      occurredAt: hoursAgo(3),
    });
    await create(s.app, s.ana, {
      type: 'income',
      categoryId: salary,
      rate: MANUAL_RATE,
      accountId: ars,
      amount: '900000',
      occurredAt: hoursAgo(4),
    });
    await create(s.app, s.ana, {
      type: 'transfer',
      accountId: ars,
      destinationAccountId: otherArs,
      amount: '70000',
      occurredAt: hoursAgo(5),
    });

    const response = await get(s.app, '/movements/summary', s.ana);
    expect(response.status).toBe(200);
    const rows = byKey(movementSummaryResponseSchema.parse(response.body).rows);
    expect(rows.size).toBe(3);
    expect(rows.get(`${food}|ARS|expense`)).toMatchObject({ amount: '200000', count: 2 });
    expect(rows.get(`${food}|USD|expense`)).toMatchObject({ amount: '1200', count: 1 });
    expect(rows.get(`${salary}|ARS|income`)).toMatchObject({ amount: '900000', count: 1 });
  });

  it('applies the list filters: category, type and account', async () => {
    const s = await setup();
    const ars = await newAccount(connection.pool, s.anaId);
    const otherArs = await newAccount(connection.pool, s.anaId);
    const food = await newCategory(connection.pool, s.anaId, 'expense');
    const fuel = await newCategory(connection.pool, s.anaId, 'expense');
    const salary = await newCategory(connection.pool, s.anaId, 'income');
    const base = { type: 'expense', rate: MANUAL_RATE, occurredAt: hoursAgo(1) };
    await create(s.app, s.ana, { ...base, accountId: ars, categoryId: food, amount: '1000' });
    await create(s.app, s.ana, { ...base, accountId: otherArs, categoryId: food, amount: '3000' });
    await create(s.app, s.ana, { ...base, accountId: ars, categoryId: fuel, amount: '5000' });
    await create(s.app, s.ana, {
      ...base,
      type: 'income',
      accountId: ars,
      categoryId: salary,
      amount: '7000',
    });

    const ofFood = movementSummaryResponseSchema.parse(
      (await get(s.app, `/movements/summary?categoryId=${food}`, s.ana)).body,
    ).rows;
    expect(ofFood).toEqual([
      { categoryId: food, currency: 'ARS', type: 'expense', amount: '4000', count: 2 },
    ]);
    const ofAccount = movementSummaryResponseSchema.parse(
      (await get(s.app, `/movements/summary?accountId=${otherArs}`, s.ana)).body,
    ).rows;
    expect(ofAccount).toEqual([
      { categoryId: food, currency: 'ARS', type: 'expense', amount: '3000', count: 1 },
    ]);
    const incomes = movementSummaryResponseSchema.parse(
      (await get(s.app, '/movements/summary?type=income', s.ana)).body,
    ).rows;
    expect(incomes).toEqual([
      { categoryId: salary, currency: 'ARS', type: 'income', amount: '7000', count: 1 },
    ]);
    const transfers = movementSummaryResponseSchema.parse(
      (await get(s.app, '/movements/summary?type=transfer', s.ana)).body,
    ).rows;
    expect(transfers).toEqual([]);
  });

  it("never counts another user's movements and treats a foreign category as matching nothing", async () => {
    const s = await setup();
    const bobsAccount = await newAccount(connection.pool, s.bobId);
    const bobsCategory = await newCategory(connection.pool, s.bobId, 'expense');
    await create(s.app, s.bob, {
      type: 'expense',
      accountId: bobsAccount,
      categoryId: bobsCategory,
      amount: '1000',
      occurredAt: hoursAgo(1),
      rate: MANUAL_RATE,
    });

    const all = await get(s.app, '/movements/summary', s.ana);
    expect(movementSummaryResponseSchema.parse(all.body).rows).toEqual([]);
    const foreign = await get(s.app, `/movements/summary?categoryId=${bobsCategory}`, s.ana);
    expect(movementSummaryResponseSchema.parse(foreign.body).rows).toEqual([]);
  });

  it('answers 400 VALIDATION_FAILED for a malformed filter or a reversed range', async () => {
    const s = await setup();
    const malformed = await get(s.app, '/movements/summary?categoryId=nope', s.ana);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const reversed = await get(s.app, '/movements/summary?from=2026-05-02&to=2026-05-01', s.ana);
    expect(reversed.status).toBe(400);
    expect(reversed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers 401 without a session', async () => {
    const s = await setup();
    const response = await get(s.app, '/movements/summary');
    expect(response.status).toBe(401);
  });
});
