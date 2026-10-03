import type { PortfolioResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInvestmentsRoutes } from '../../src/investments';
import { DrizzleHoldingRepository } from '../../src/investments/infrastructure/db/drizzle-holding-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { scopeFor } from './fakes/in-memory-investments';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const ANA = 'ana@portfolios.test';
const BOB = 'bob@portfolios.test';
const UNVERIFIED = 'carl@portfolios.test';
const MISSING_ID = '3f1c9a52-8a0e-4c7e-9f0d-5b6f1b0c2a11';

interface Setup {
  app: Express;
  lines: string[];
  anaId: string;
  bobId: string;
  ana: string;
  bob: string;
}

/** The module gets its own logger and MutableClock; sessions and the verified guard are real. */
async function setup(db = connection.db): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createInvestmentsRoutes({ db, clock: new MutableClock(), logger })],
  });
  const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
  const bobId = await seedUser(connection, { email: BOB, password: PASSWORD });
  const ana = cookieHeader(sessionFrom(await signIn(harness.app, ANA, PASSWORD)));
  const bob = cookieHeader(sessionFrom(await signIn(harness.app, BOB, PASSWORD)));
  return { app: harness.app, lines, anaId, bobId, ana, bob };
}

function list(app: Express, cookie: string) {
  return request(app).get('/investments/portfolios').set('Cookie', cookie);
}

function create(app: Express, cookie: string, body: unknown) {
  return request(app)
    .post('/investments/portfolios')
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send(body as object);
}

function remove(app: Express, cookie: string, id: string) {
  return request(app)
    .delete(`/investments/portfolios/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send();
}

async function createdId(app: Express, cookie: string, name: string): Promise<string> {
  const response = await create(app, cookie, { name });
  return (response.body as PortfolioResponse).id;
}

async function count(table: 'portfolios' | 'holdings'): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(result.rows[0]?.n);
}

describe('portfolio routes', () => {
  it('creates a portfolio named "Balanz" with 201 and lists it (AC-01)', async () => {
    const { app, ana } = await setup();

    const created = await create(app, ana, { name: '  Balanz  ' });

    expect(created.status).toBe(201);
    const body = created.body as PortfolioResponse;
    expect(body).toMatchObject({
      name: 'Balanz',
      totals: [],
      holdingsWithoutPrice: 0,
      holdings: [],
    });
    const listed = await list(app, ana);
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { portfolios: PortfolioResponse[] }).portfolios.map((p) => p.id),
    ).toEqual([body.id]);
  });

  it('ignores an ownerId of another user in the create body', async () => {
    const { app, ana, bob, anaId, bobId } = await setup();

    const created = await create(app, ana, { name: 'Mine', ownerId: bobId });

    expect(created.status).toBe(201);
    const id = (created.body as PortfolioResponse).id;
    const row = await connection.pool.query<{ owner_id: string }>(
      'select owner_id from portfolios where id = $1',
      [id],
    );
    expect(row.rows[0]?.owner_id).toBe(anaId);
    const bobList = await list(app, bob);
    expect((bobList.body as { portfolios: PortfolioResponse[] }).portfolios).toEqual([]);
    const anaList = await list(app, ana);
    expect(
      (anaList.body as { portfolios: PortfolioResponse[] }).portfolios.map((p) => p.id),
    ).toEqual([id]);
  });

  it('answers 404 to user B reading or deleting the portfolio of user A, and A keeps it (AC-15)', async () => {
    const { app, ana, bob } = await setup();
    const id = await createdId(app, ana, 'Balanz');

    const read = await request(app).get(`/investments/portfolios/${id}`).set('Cookie', bob);
    const deleted = await remove(app, bob, id);
    const missing = await request(app)
      .get(`/investments/portfolios/${MISSING_ID}`)
      .set('Cookie', bob);

    expect(read.status).toBe(404);
    expect(read.body).toEqual({ code: 'NOT_FOUND' });
    expect(deleted.status).toBe(404);
    expect(deleted.body).toEqual(read.body);
    expect(missing.body).toEqual(read.body);
    const own = await request(app).get(`/investments/portfolios/${id}`).set('Cookie', ana);
    expect(own.status).toBe(200);
    expect((own.body as PortfolioResponse).name).toBe('Balanz');
  });

  it('carries the market price fields on the list and the read for a manual crypto price 6.67% away (AC-07)', async () => {
    const { app, ana, anaId } = await setup();
    const holdings = new DrizzleHoldingRepository(connection.db);
    const portfolioId = await createdId(app, ana, 'Crypto');
    const write = await scopeFor(anaId, 'write');
    const btc = await holdings.insert(write, portfolioId, {
      ticker: 'BTC',
      instrumentName: 'Bitcoin',
      instrumentType: 'crypto',
      quantity: 100_000_000n,
      valuationCurrency: 'USD',
      totalCost: null,
    });
    const aapl = await holdings.insert(write, portfolioId, {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: 1_000_000_000n,
      valuationCurrency: 'ARS',
      totalCost: null,
    });
    if (btc === null || aapl === null) throw new Error('fixture insert failed');
    await holdings.setPrice(write, btc.id, 6_000_000n, 'manual', new Date());
    const marketAt = new Date(Date.now() - 3 * 3_600_000);
    await connection.pool.query(
      `insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 6400000, $1)`,
      [marketAt.toISOString()],
    );

    const listed = await list(app, ana);
    const read = await request(app)
      .get(`/investments/portfolios/${portfolioId}`)
      .set('Cookie', ana);

    const fromList = (listed.body as { portfolios: PortfolioResponse[] }).portfolios[0];
    for (const portfolio of [fromList, read.body as PortfolioResponse]) {
      const bitcoin = portfolio?.holdings.find((h) => h.ticker === 'BTC');
      const apple = portfolio?.holdings.find((h) => h.ticker === 'AAPL');
      expect(bitcoin).toMatchObject({
        marketUnitPrice: '6400000',
        marketPricedAt: marketAt.toISOString(),
        marketPriceDiffers: true,
        marketPriceRecent: true,
      });
      expect(apple).toMatchObject({
        marketUnitPrice: null,
        marketPricedAt: null,
        marketPriceDiffers: false,
        marketPriceRecent: false,
      });
    }
  });

  it('lists only the portfolios of the caller (AC-16)', async () => {
    const { app, ana, bob } = await setup();
    const anaPortfolio = await createdId(app, ana, 'Ana portfolio');
    await createdId(app, bob, 'Bob portfolio');

    const listed = await list(app, ana);

    expect(
      (listed.body as { portfolios: PortfolioResponse[] }).portfolios.map((p) => p.id),
    ).toEqual([anaPortfolio]);
  });

  it('deletes with 204, removes its holdings and leaves every other row alone (AC-17)', async () => {
    const { app, ana, bob, anaId, bobId } = await setup();
    const holdings = new DrizzleHoldingRepository(connection.db);
    const doomed = await createdId(app, ana, 'Doomed');
    const bobPortfolio = await createdId(app, bob, 'Bob portfolio');
    const draft = {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear' as const,
      quantity: 1_000_000_000n,
      valuationCurrency: 'ARS' as const,
      totalCost: null,
    };
    await holdings.insert(await scopeFor(anaId, 'write'), doomed, draft);
    await holdings.insert(await scopeFor(bobId, 'write'), bobPortfolio, draft);
    expect(await count('holdings')).toBe(2);

    const deleted = await remove(app, ana, doomed);

    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');
    // The module has no link to accounts, so "balances untouched" is shown through what the
    // delete could reach: the other user's portfolio and holding, and both user rows.
    expect(await count('holdings')).toBe(1);
    expect(await count('portfolios')).toBe(1);
    const users = await connection.pool.query('select id from users where id = any($1)', [
      [anaId, bobId],
    ]);
    expect(users.rowCount).toBe(2);
    const bobList = await list(app, bob);
    expect(
      (bobList.body as { portfolios: PortfolioResponse[] }).portfolios[0]?.holdings,
    ).toHaveLength(1);
  });

  it('rejects an empty name, a 61-character name and a non-UUID id with 400 and the failing fields', async () => {
    const { app, ana } = await setup();

    const empty = await create(app, ana, { name: '' });
    const spaces = await create(app, ana, { name: '   ' });
    const tooLong = await create(app, ana, { name: 'x'.repeat(61) });
    const badId = await request(app).get('/investments/portfolios/not-a-uuid').set('Cookie', ana);
    const badDelete = await remove(app, ana, 'not-a-uuid');

    for (const response of [empty, spaces, tooLong]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.name'] });
    }
    for (const response of [badId, badDelete]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['params.portfolioId'] });
    }
    expect(await count('portfolios')).toBe(0);
    const sixty = await create(app, ana, { name: 'x'.repeat(60) });
    expect(sixty.status).toBe(201);
  });

  it('answers 401 without a session and 403 with an unverified email', async () => {
    const { app } = await setup();
    await seedUser(connection, { email: UNVERIFIED, password: PASSWORD, verified: false });
    const carl = cookieHeader(sessionFrom(await signIn(app, UNVERIFIED, PASSWORD)));

    const anonymous = [
      await request(app).get('/investments/portfolios'),
      await request(app).get(`/investments/portfolios/${MISSING_ID}`),
      await request(app).post('/investments/portfolios').set(trustedHeaders).send({ name: 'x' }),
      await request(app).delete(`/investments/portfolios/${MISSING_ID}`).set(trustedHeaders),
    ];
    const unverified = [
      await list(app, carl),
      await request(app).get(`/investments/portfolios/${MISSING_ID}`).set('Cookie', carl),
      await create(app, carl, { name: 'x' }),
      await remove(app, carl, MISSING_ID),
    ];

    for (const response of anonymous) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    }
    for (const response of unverified) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    }
    expect(await count('portfolios')).toBe(0);
  });

  it('writes one investments.mutation line per create and delete, without the portfolio name', async () => {
    const { app, ana, anaId, lines } = await setup();

    const created = await create(app, ana, { name: 'Secret broker name' });
    const id = (created.body as PortfolioResponse).id;
    await remove(app, ana, id);

    const entries = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'investments.mutation');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      userId: anaId,
      action: 'portfolio.create',
      portfolioId: id,
      requestId: created.headers['x-request-id'],
    });
    expect(entries[1]).toMatchObject({
      userId: anaId,
      action: 'portfolio.delete',
      portfolioId: id,
    });
    expect(lines.join('\n')).not.toContain('Secret broker name');
  });

  it('writes no mutation line for a rejected request', async () => {
    const { app, bob, lines } = await setup();

    await remove(app, bob, MISSING_ID);
    await create(app, bob, { name: '' });

    expect(lines.filter((line) => line.includes('investments.mutation'))).toHaveLength(0);
  });

  it('answers 500 INTERNAL without stack or driver text when the repository fails', async () => {
    const broken = createDatabase(testDatabaseUrl);
    await broken.pool.end();
    const { app, ana } = await setup(broken.db);

    const responses = [
      await list(app, ana),
      await create(app, ana, { name: 'Balanz' }),
      await remove(app, ana, MISSING_ID),
    ];

    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL' });
      expect(response.text).not.toMatch(/pool|select|insert|portfolios|at /i);
    }
  });
});
