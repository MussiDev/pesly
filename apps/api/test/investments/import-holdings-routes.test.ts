import type { ImportHoldingsResponse, PortfolioResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInvestmentsRoutes } from '../../src/investments';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const ANA = 'ana@holdings-import.test';
const BOB = 'bob@holdings-import.test';
const CARL = 'carl@holdings-import.test';
const MISSING_ID = '3f1c9a52-8a0e-4c7e-9f0d-5b6f1b0c2a11';

async function setup() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createInvestmentsRoutes({ db: connection.db, clock: new MutableClock(), logger }),
    ],
  });
  await seedUser(connection, { email: ANA, password: PASSWORD });
  await seedUser(connection, { email: BOB, password: PASSWORD });
  await seedUser(connection, { email: CARL, password: PASSWORD, verified: false });
  const cookieOf = async (email: string) =>
    cookieHeader(sessionFrom(await signIn(harness.app, email, PASSWORD)));
  return {
    app: harness.app,
    lines,
    ana: await cookieOf(ANA),
    bob: await cookieOf(BOB),
    carl: await cookieOf(CARL),
  };
}

async function portfolioOf(app: Express, cookie: string): Promise<string> {
  const response = await request(app)
    .post('/investments/portfolios')
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send({ name: 'Balanz' });
  return (response.body as PortfolioResponse).id;
}

const row = (ticker: string, overrides: Record<string, unknown> = {}) => ({
  ticker,
  instrumentName: `${ticker} CEDEAR`,
  instrumentType: 'cedear',
  valuationCurrency: 'ARS',
  quantity: '4600000000',
  totalCost: '41949600',
  unitPrice: '753500',
  pricedOn: '2026-10-09',
  ...overrides,
});

function importHoldings(app: Express, cookie: string, portfolioId: string, body: unknown) {
  return request(app)
    .post(`/investments/portfolios/${portfolioId}/holdings/import`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send(body as object);
}

function listOf(app: Express, cookie: string, portfolioId: string) {
  return request(app)
    .get(`/investments/portfolios/${portfolioId}`)
    .set('Cookie', cookie)
    .then((response) => response.body as PortfolioResponse);
}

describe('POST /investments/portfolios/:portfolioId/holdings/import', () => {
  it('replaces the holdings and answers the counts and the portfolio (AC-01, AC-03)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    await request(app)
      .post(`/investments/portfolios/${portfolioId}/holdings`)
      .set(trustedHeaders)
      .set('Cookie', ana)
      .send({
        ticker: 'AAPL',
        instrumentName: 'Apple',
        instrumentType: 'cedear',
        quantity: '100000000',
        valuationCurrency: 'ARS',
      });

    const response = await importHoldings(app, ana, portfolioId, {
      holdings: [row('IBIT'), row('SPY', { valuationCurrency: 'USD' })],
    });

    expect(response.status).toBe(200);
    const body = response.body as ImportHoldingsResponse;
    expect({ created: body.created, updated: body.updated, removed: body.removed }).toEqual({
      created: 2,
      updated: 0,
      removed: 1,
    });
    expect(body.portfolio.holdings.map((holding) => holding.ticker).sort()).toEqual([
      'IBIT',
      'SPY',
    ]);
    const spy = body.portfolio.holdings.find((holding) => holding.ticker === 'SPY');
    expect(spy).toMatchObject({
      valuationCurrency: 'USD',
      priceSource: 'import',
      unitPrice: '753500',
      totalCost: '41949600',
      pricedAt: '2026-10-09T00:00:00.000Z',
    });
  });

  it('accepts 1,000 holdings under the body limit and rejects 1,001 (NFR-01)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const rows = (count: number) => Array.from({ length: count }, (_, index) => row(`T${index}`));

    const accepted = await importHoldings(app, ana, portfolioId, { holdings: rows(1000) });
    const rejected = await importHoldings(app, ana, portfolioId, { holdings: rows(1001) });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect((await listOf(app, ana, portfolioId)).holdings).toHaveLength(1000);
  });

  it('keeps the 16 KB limit for a path that only resembles the import path (threat R-03)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const big = { holdings: Array.from({ length: 150 }, (_, index) => row(`T${index}`)) };

    const lookalike = await request(app)
      .post(`/investments/portfolios/${portfolioId}/holdings/import-extra`)
      .set(trustedHeaders)
      .set('Cookie', ana)
      .send(big);
    const nested = await request(app)
      .post(`/x/investments/portfolios/${portfolioId}/holdings/import`)
      .set(trustedHeaders)
      .set('Cookie', ana)
      .send(big);
    const real = await importHoldings(app, ana, portfolioId, big);

    expect(lookalike.status).toBe(413);
    expect(nested.status).toBe(413);
    expect(real.status).toBe(200);
  });

  it.each([
    ['an empty list', { holdings: [] }],
    ['no body', {}],
    ['crypto', { holdings: [row('BTC', { instrumentType: 'crypto' })] }],
    ['a decimal quantity', { holdings: [row('IBIT', { quantity: '1.5' })] }],
    ['a non-calendar day', { holdings: [row('IBIT', { pricedOn: '2026-02-30' })] }],
    ['a repeated ticker', { holdings: [row('IBIT'), row('ibit')] }],
  ])('rejects %s and leaves the portfolio unchanged (AC-05)', async (_label, body) => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    await importHoldings(app, ana, portfolioId, { holdings: [row('SPY')] });

    const response = await importHoldings(app, ana, portfolioId, body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await listOf(app, ana, portfolioId)).holdings.map((holding) => holding.ticker)).toEqual(
      ['SPY'],
    );
  });

  it('answers 404 for a portfolio of another user, 401 without a session, 403 unverified (AC-05)', async () => {
    const { app, ana, bob, carl } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const body = { holdings: [row('IBIT')] };

    const foreign = await importHoldings(app, bob, portfolioId, body);
    const missing = await importHoldings(app, ana, MISSING_ID, body);
    const anonymous = await importHoldings(app, '', portfolioId, body);
    const unverified = await importHoldings(app, carl, portfolioId, body);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(anonymous.status).toBe(401);
    expect(unverified.status).toBe(403);
    expect((await listOf(app, ana, portfolioId)).holdings).toHaveLength(0);
  });

  it('logs the counts only, never tickers, names, quantities or prices (NFR-02, threat R-04)', async () => {
    const { app, ana, lines } = await setup();
    const portfolioId = await portfolioOf(app, ana);

    await importHoldings(app, ana, portfolioId, {
      holdings: [
        row('SECR', {
          instrumentName: 'Secret Instrument',
          quantity: '1234500000',
          totalCost: '98765432',
          unitPrice: '7654321',
        }),
      ],
    });

    const entries = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.action === 'holdings.import');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ created: 1, updated: 0, removed: 0 });
    const all = lines.join('\n');
    for (const leaked of ['SECR', 'Secret Instrument', '1234500000', '98765432', '7654321']) {
      expect(all).not.toContain(leaked);
    }
  });
});
