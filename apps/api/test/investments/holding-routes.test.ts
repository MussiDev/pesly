import type { AddHoldingResponse, HoldingResponse, PortfolioResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInvestmentsRoutes } from '../../src/investments';
import { DrizzleMarketPriceReader } from '../../src/investments/infrastructure/db/drizzle-market-price-reader';
import type { InvestmentsDb } from '../../src/investments/infrastructure/db/schema';
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
const ANA = 'ana@holdings.test';
const BOB = 'bob@holdings.test';
const UNVERIFIED = 'carl@holdings.test';
const MISSING_ID = '3f1c9a52-8a0e-4c7e-9f0d-5b6f1b0c2a11';
const DAY_MS = 24 * 3_600_000;

interface Setup {
  app: Express;
  lines: string[];
  clock: MutableClock;
  anaId: string;
  ana: string;
  bob: string;
}

async function setup(db: InvestmentsDb = connection.db): Promise<Setup> {
  const lines: string[] = [];
  const clock = new MutableClock();
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createInvestmentsRoutes({ db, clock, logger })],
  });
  const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
  await seedUser(connection, { email: BOB, password: PASSWORD });
  const ana = cookieHeader(sessionFrom(await signIn(harness.app, ANA, PASSWORD)));
  const bob = cookieHeader(sessionFrom(await signIn(harness.app, BOB, PASSWORD)));
  return { app: harness.app, lines, clock, anaId, ana, bob };
}

async function portfolioOf(app: Express, cookie: string, name = 'Balanz'): Promise<string> {
  const response = await request(app)
    .post('/investments/portfolios')
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send({ name });
  return (response.body as PortfolioResponse).id;
}

const AAPL = {
  ticker: 'AAPL',
  instrumentName: 'Apple',
  instrumentType: 'cedear',
  quantity: '1000000000',
  valuationCurrency: 'ARS',
  totalCost: '15000000',
};

function add(app: Express, cookie: string, portfolioId: string, body: unknown) {
  return request(app)
    .post(`/investments/portfolios/${portfolioId}/holdings`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send(body as object);
}

function read(app: Express, cookie: string, id: string) {
  return request(app).get(`/investments/holdings/${id}`).set('Cookie', cookie);
}

function edit(app: Express, cookie: string, id: string, body: unknown) {
  return request(app)
    .patch(`/investments/holdings/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send(body as object);
}

function price(app: Express, cookie: string, id: string, body: unknown) {
  return request(app)
    .put(`/investments/holdings/${id}/price`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send(body as object);
}

function automatic(app: Express, cookie: string, id: string) {
  return request(app)
    .post(`/investments/holdings/${id}/automatic-price`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send();
}

const BTC = {
  ticker: 'BTC',
  instrumentName: 'Bitcoin',
  instrumentType: 'crypto',
  quantity: '100000000',
  valuationCurrency: 'USD',
};

async function storeMarketPrice(symbol: string, unitPrice: string, pricedAt: Date): Promise<void> {
  await connection.pool.query(
    'insert into crypto_market_prices (symbol, unit_price, priced_at) values ($1, $2, $3)',
    [symbol, unitPrice, pricedAt.toISOString()],
  );
}

/** A manual BTC holding at 60,000.00 USD; the market price stored for it is 64,000.00 USD, 3 hours old. */
async function manualCrypto(ctx: Setup): Promise<{ id: string; marketAt: Date }> {
  const id = await addedId(ctx.app, ctx.ana, await portfolioOf(ctx.app, ctx.ana), BTC);
  await price(ctx.app, ctx.ana, id, { unitPrice: '6000000' });
  const marketAt = new Date(ctx.clock.now().getTime() - 3 * 3_600_000);
  await storeMarketPrice('btc', '6400000', marketAt);
  return { id, marketAt };
}

function remove(app: Express, cookie: string, id: string) {
  return request(app)
    .delete(`/investments/holdings/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookie)
    .send();
}

async function addedId(
  app: Express,
  cookie: string,
  portfolioId: string,
  body: unknown = AAPL,
): Promise<string> {
  const response = await add(app, cookie, portfolioId, body);
  return (response.body as AddHoldingResponse).holding.id;
}

async function portfolio(app: Express, cookie: string, id: string): Promise<PortfolioResponse> {
  const response = await request(app).get(`/investments/portfolios/${id}`).set('Cookie', cookie);
  return response.body as PortfolioResponse;
}

describe('holding routes', () => {
  it('adds AAPL as a CEDEAR with 201 and no price (AC-02)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);

    const response = await add(app, ana, portfolioId, AAPL);

    expect(response.status).toBe(201);
    const body = response.body as AddHoldingResponse;
    expect(body.merged).toBe(false);
    expect(body.holding).toMatchObject({
      portfolioId,
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: '1000000000',
      valuationCurrency: 'ARS',
      totalCost: '15000000',
      unitPrice: null,
      priceSource: null,
      pricedAt: null,
      priceStale: false,
      value: null,
      gain: null,
      marketUnitPrice: null,
      marketPricedAt: null,
      marketPriceDiffers: false,
      marketPriceRecent: false,
    });
    const fetched = await read(app, ana, body.holding.id);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(body.holding);
  });

  it('rejects quantity 0 and a negative quantity with 400 on body.quantity (AC-03)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);

    for (const quantity of ['0', '-5']) {
      const response = await add(app, ana, portfolioId, { ...AAPL, quantity });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.quantity'] });
    }
    expect((await portfolio(app, ana, portfolioId)).holdings).toHaveLength(0);
  });

  it('edits the quantity from 10 to 15 and returns the recomputed value (AC-05)', async () => {
    const { app, ana } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));
    await price(app, ana, id, { unitPrice: '1850000' });

    const response = await edit(app, ana, id, { quantity: '1500000000' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ quantity: '1500000000', value: '27750000' });
  });

  it('keeps the cost when the patch has no totalCost and clears it with null', async () => {
    const { app, ana } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));

    const kept = await edit(app, ana, id, { quantity: '2' });
    const cleared = await edit(app, ana, id, { totalCost: null });

    expect((kept.body as HoldingResponse).totalCost).toBe('15000000');
    expect((cleared.body as HoldingResponse).totalCost).toBeNull();
  });

  it('rejects an empty patch with 400', async () => {
    const { app, ana } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));

    const response = await edit(app, ana, id, {});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('deletes with 204 and recomputes the portfolio total (AC-06)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const apple = await addedId(app, ana, portfolioId);
    const google = await addedId(app, ana, portfolioId, { ...AAPL, ticker: 'GOOGL' });
    await price(app, ana, apple, { unitPrice: '1850000' });
    await price(app, ana, google, { unitPrice: '100000' });
    expect((await portfolio(app, ana, portfolioId)).totals).toEqual([
      { currency: 'ARS', value: '19500000' },
    ]);

    const deleted = await remove(app, ana, google);

    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');
    expect((await portfolio(app, ana, portfolioId)).totals).toEqual([
      { currency: 'ARS', value: '18500000' },
    ]);
    expect((await read(app, ana, google)).status).toBe(404);
  });

  it('sets a manual price of 18,500.00 and values 10 units at 185,000.00 (AC-07, AC-09, AC-10)', async () => {
    const { app, ana, clock } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));

    const response = await price(app, ana, id, { unitPrice: '1850000' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      unitPrice: '1850000',
      priceSource: 'manual',
      pricedAt: clock.now().toISOString(),
      priceStale: false,
      value: '18500000',
    });
  });

  it('rejects a manual price of 0 with 400 on body.unitPrice (AC-08)', async () => {
    const { app, ana } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));

    const response = await price(app, ana, id, { unitPrice: '0' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.unitPrice'] });
    expect(((await read(app, ana, id)).body as HoldingResponse).unitPrice).toBeNull();
  });

  it('returns gain 35,000.00 and 2333 basis points, and null gain without a cost (AC-11, AC-12)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const withCost = await addedId(app, ana, portfolioId);
    const withoutCost = await addedId(app, ana, portfolioId, {
      ...AAPL,
      ticker: 'MSFT',
      totalCost: undefined,
    });

    const gained = await price(app, ana, withCost, { unitPrice: '1850000' });
    const unknown = await price(app, ana, withoutCost, { unitPrice: '1850000' });

    expect((gained.body as HoldingResponse).gain).toEqual({
      amount: '3500000',
      basisPoints: '2333',
    });
    expect((unknown.body as HoldingResponse).totalCost).toBeNull();
    expect((unknown.body as HoldingResponse).gain).toBeNull();
    expect((unknown.body as HoldingResponse).value).toBe('18500000');
  });

  it('returns null value and gain without a price, excluded from totals and counted (AC-19, AC-20, AC-21)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const priced = await addedId(app, ana, portfolioId);
    await price(app, ana, priced, { unitPrice: '1850000' });
    const unpriced = await addedId(app, ana, portfolioId, { ...AAPL, ticker: 'MELI' });

    const holding = (await read(app, ana, unpriced)).body as HoldingResponse;
    const summary = await portfolio(app, ana, portfolioId);

    expect(holding.value).toBeNull();
    expect(holding.gain).toBeNull();
    expect(summary.totals).toEqual([{ currency: 'ARS', value: '18500000' }]);
    expect(summary.holdingsWithoutPrice).toBe(1);
  });

  it('marks a price set 8 days ago as stale and keeps its date (AC-14)', async () => {
    const { app, ana, clock } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));
    const set = await price(app, ana, id, { unitPrice: '1850000' });
    const pricedAt = (set.body as HoldingResponse).pricedAt;
    clock.advance(8 * DAY_MS);

    const response = await read(app, ana, id);

    expect(response.body).toMatchObject({ priceStale: true, pricedAt });
  });

  it('answers 404 to user B on every route over the holding of user A, and nothing changes (AC-15)', async () => {
    const { app, ana, bob } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const id = await addedId(app, ana, portfolioId);
    const before = (await read(app, ana, id)).body as HoldingResponse;

    const responses = [
      await read(app, bob, id),
      await edit(app, bob, id, { quantity: '5' }),
      await price(app, bob, id, { unitPrice: '100' }),
      await automatic(app, bob, id),
      await automatic(app, bob, MISSING_ID),
      await remove(app, bob, id),
      await add(app, bob, portfolioId, { ...AAPL, ticker: 'MELI' }),
      await read(app, bob, MISSING_ID),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect((await read(app, ana, id)).body).toEqual(before);
    expect((await portfolio(app, ana, portfolioId)).holdings).toHaveLength(1);
  });

  it('rejects crypto in ARS on add and on edit with 400 on valuationCurrency (AC-18)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const crypto = { ...AAPL, ticker: 'BTC', instrumentType: 'crypto' };

    const added = await add(app, ana, portfolioId, { ...crypto, valuationCurrency: 'ARS' });
    const id = await addedId(app, ana, portfolioId, { ...crypto, valuationCurrency: 'USD' });
    const edited = await edit(app, ana, id, { valuationCurrency: 'ARS', totalCost: '100' });

    expect(added.status).toBe(400);
    expect(added.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.valuationCurrency'] });
    expect(edited.status).toBe(400);
    expect(edited.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.valuationCurrency'] });
    expect(((await read(app, ana, id)).body as HoldingResponse).valuationCurrency).toBe('USD');
  });

  it('clears the price when the currency changes with a stated cost, and rejects it without the cost key (AC-22)', async () => {
    const { app, ana } = await setup();
    const id = await addedId(app, ana, await portfolioOf(app, ana));
    await price(app, ana, id, { unitPrice: '1850000' });

    const missingCost = await edit(app, ana, id, { valuationCurrency: 'USD' });
    const changed = await edit(app, ana, id, { valuationCurrency: 'USD', totalCost: '100000' });

    expect(missingCost.status).toBe(400);
    expect(missingCost.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.totalCost'] });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      valuationCurrency: 'USD',
      totalCost: '100000',
      unitPrice: null,
      priceSource: null,
      pricedAt: null,
      value: null,
    });
  });

  it('merges "aapl" into "AAPL" with 200: 15 units, cost 200,000.00, old price kept (AC-23)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const id = await addedId(app, ana, portfolioId);
    await price(app, ana, id, { unitPrice: '1850000' });

    const response = await add(app, ana, portfolioId, {
      ...AAPL,
      ticker: 'aapl',
      quantity: '500000000',
      totalCost: '5000000',
    });

    expect(response.status).toBe(200);
    const body = response.body as AddHoldingResponse;
    expect(body.merged).toBe(true);
    expect(body.holding).toMatchObject({
      id,
      ticker: 'AAPL',
      quantity: '1500000000',
      totalCost: '20000000',
      unitPrice: '1850000',
      priceSource: 'manual',
    });
    expect((await portfolio(app, ana, portfolioId)).holdings).toHaveLength(1);
  });

  it('rejects a merge in another currency with 400 on body.valuationCurrency and leaves the holding (AC-24)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const id = await addedId(app, ana, portfolioId);
    const before = (await read(app, ana, id)).body as HoldingResponse;

    const response = await add(app, ana, portfolioId, { ...AAPL, valuationCurrency: 'USD' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'VALIDATION_FAILED',
      fields: ['body.valuationCurrency'],
    });
    expect((await read(app, ana, id)).body).toEqual(before);
  });

  it('merges with one missing cost into a null cost (AC-25)', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    await addedId(app, ana, portfolioId);

    const response = await add(app, ana, portfolioId, { ...AAPL, totalCost: undefined });

    expect(response.status).toBe(200);
    expect((response.body as AddHoldingResponse).holding.totalCost).toBeNull();
  });

  it('ignores ownerId, portfolioId and source keys in the add body', async () => {
    const { app, ana, bob } = await setup();
    const own = await portfolioOf(app, ana, 'Own');
    const other = await portfolioOf(app, bob, 'Bob');

    const response = await add(app, ana, own, {
      ...AAPL,
      ownerId: MISSING_ID,
      portfolioId: other,
      source: 'automatic',
      unitPrice: '999',
    });

    expect(response.status).toBe(201);
    expect((response.body as AddHoldingResponse).holding).toMatchObject({
      portfolioId: own,
      unitPrice: null,
      priceSource: null,
    });
    expect((await portfolio(app, bob, other)).holdings).toHaveLength(0);
  });

  it('rejects malformed ids and bodies with 400 and the failing fields', async () => {
    const { app, ana } = await setup();
    const portfolioId = await portfolioOf(app, ana);

    const badTicker = await add(app, ana, portfolioId, { ...AAPL, ticker: '!!' });
    const badType = await add(app, ana, portfolioId, { ...AAPL, instrumentType: 'nft' });
    const badPortfolio = await add(app, ana, 'not-a-uuid', AAPL);
    const badHolding = await read(app, ana, 'not-a-uuid');
    const badPatchId = await edit(app, ana, 'not-a-uuid', { quantity: '1' });

    expect(badTicker.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.ticker'] });
    expect(badType.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.instrumentType'] });
    expect(badPortfolio.body).toEqual({
      code: 'VALIDATION_FAILED',
      fields: ['params.portfolioId'],
    });
    expect(badHolding.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['params.holdingId'] });
    expect(badPatchId.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['params.holdingId'] });
  });

  it('writes one investments.mutation line per success, without quantities, costs, prices or names', async () => {
    const { app, ana, anaId, lines } = await setup();
    const portfolioId = await portfolioOf(app, ana);
    const secret = {
      ticker: 'SECR',
      instrumentName: 'Secret Instrument',
      instrumentType: 'stock',
      quantity: '1234500000',
      valuationCurrency: 'ARS',
      totalCost: '98765432',
    };

    const created = await add(app, ana, portfolioId, secret);
    const id = (created.body as AddHoldingResponse).holding.id;
    const merged = await add(app, ana, portfolioId, secret);
    await edit(app, ana, id, { quantity: '1234500001' });
    await price(app, ana, id, { unitPrice: '7654321' });
    await remove(app, ana, id);
    // Rejected requests write nothing.
    await remove(app, ana, id);
    await price(app, ana, id, { unitPrice: '0' });

    const entries = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'investments.mutation' && entry.holdingId !== undefined);
    expect(entries.map((entry) => entry.action)).toEqual([
      'holding.add',
      'holding.merge',
      'holding.update',
      'holding.price',
      'holding.delete',
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ userId: anaId, holdingId: id });
    }
    expect(entries[0]).toMatchObject({ requestId: created.headers['x-request-id'] });
    expect(merged.status).toBe(200);
    const all = lines.join('\n');
    for (const leaked of ['1234500000', '1234500001', '98765432', '7654321', 'Secret Instrument']) {
      expect(all).not.toContain(leaked);
    }
  });

  it('answers 401 without a session and 403 with an unverified email', async () => {
    const { app } = await setup();
    await seedUser(connection, { email: UNVERIFIED, password: PASSWORD, verified: false });
    const carl = cookieHeader(sessionFrom(await signIn(app, UNVERIFIED, PASSWORD)));
    const none = '';

    const calls = (cookie: string) => [
      add(app, cookie, MISSING_ID, AAPL),
      read(app, cookie, MISSING_ID),
      edit(app, cookie, MISSING_ID, { quantity: '1' }),
      price(app, cookie, MISSING_ID, { unitPrice: '1' }),
      automatic(app, cookie, MISSING_ID),
      remove(app, cookie, MISSING_ID),
    ];

    for (const response of await Promise.all(calls(none))) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    }
    for (const response of await Promise.all(calls(carl))) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    }
  });

  it('answers 500 INTERNAL without SQL or stack text when the repository throws', async () => {
    const failing = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('select "quantity" from "holdings" where owner failed');
        },
      },
    ) as unknown as InvestmentsDb;
    const { app, ana } = await setup(failing);

    const responses = [
      await add(app, ana, MISSING_ID, AAPL),
      await read(app, ana, MISSING_ID),
      await edit(app, ana, MISSING_ID, { quantity: '1' }),
      await price(app, ana, MISSING_ID, { unitPrice: '1' }),
      await automatic(app, ana, MISSING_ID),
      await remove(app, ana, MISSING_ID),
    ];

    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL' });
      expect(response.text).not.toMatch(/select|holdings|quantity|at /i);
    }
  });
});

describe('automatic price route and the market fields', () => {
  it('shows the stored market price and the warning on the holding of a manual price (AC-07)', async () => {
    const ctx = await setup();
    const { id, marketAt } = await manualCrypto(ctx);

    const response = await read(ctx.app, ctx.ana, id);

    expect(response.body).toMatchObject({
      priceSource: 'manual',
      unitPrice: '6000000',
      marketUnitPrice: '6400000',
      marketPricedAt: marketAt.toISOString(),
      marketPriceDiffers: true,
      marketPriceRecent: true,
    });
  });

  it('keeps the warning for a market price a month old, not recent (AC-11, AC-16)', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    ctx.clock.advance(30 * DAY_MS);

    const response = await read(ctx.app, ctx.ana, id);

    expect(response.body).toMatchObject({ marketPriceDiffers: true, marketPriceRecent: false });
  });

  it('POST automatic-price answers 200 with the switched holding and no warning (AC-12)', async () => {
    const ctx = await setup();
    const { id, marketAt } = await manualCrypto(ctx);

    const response = await automatic(ctx.app, ctx.ana, id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id,
      priceSource: 'automatic',
      unitPrice: '6400000',
      pricedAt: marketAt.toISOString(),
      value: '6400000',
      marketUnitPrice: '6400000',
      marketPriceDiffers: false,
    });
    expect((await read(ctx.app, ctx.ana, id)).body).toEqual(response.body);
  });

  it('POST automatic-price writes one mutation line with ids only and no amount', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    ctx.lines.length = 0;

    const response = await automatic(ctx.app, ctx.ana, id);

    const entries = ctx.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'investments.mutation');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: ctx.anaId,
      action: 'holding.automatic-price',
      holdingId: id,
      requestId: response.headers['x-request-id'],
    });
    for (const leaked of ['6400000', '6000000', '100000000']) {
      expect(ctx.lines.join('\n')).not.toContain(leaked);
    }
  });

  it('answers 404 for the holding of user B and for an unknown id, and changes nothing (AC-14)', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    const before = (await read(ctx.app, ctx.ana, id)).body as HoldingResponse;

    const foreign = await automatic(ctx.app, ctx.bob, id);
    const missing = await automatic(ctx.app, ctx.ana, MISSING_ID);

    for (const response of [foreign, missing]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect((await read(ctx.app, ctx.ana, id)).body).toEqual(before);
  });

  it('answers 400 on body.marketPrice for a stock holding and changes nothing (invalid, AC-13)', async () => {
    const ctx = await setup();
    const id = await addedId(ctx.app, ctx.ana, await portfolioOf(ctx.app, ctx.ana), {
      ...AAPL,
      ticker: 'BTC',
    });
    await price(ctx.app, ctx.ana, id, { unitPrice: '1850000' });
    await storeMarketPrice('btc', '6400000', ctx.clock.now());
    const before = (await read(ctx.app, ctx.ana, id)).body as HoldingResponse;

    const response = await automatic(ctx.app, ctx.ana, id);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.marketPrice'] });
    expect((await read(ctx.app, ctx.ana, id)).body).toEqual(before);
  });

  it('answers 400 on body.marketPrice for a crypto holding with no stored market price (invalid, AC-13)', async () => {
    const ctx = await setup();
    const id = await addedId(ctx.app, ctx.ana, await portfolioOf(ctx.app, ctx.ana), BTC);
    await price(ctx.app, ctx.ana, id, { unitPrice: '6000000' });
    const before = (await read(ctx.app, ctx.ana, id)).body as HoldingResponse;

    const response = await automatic(ctx.app, ctx.ana, id);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.marketPrice'] });
    expect((await read(ctx.app, ctx.ana, id)).body).toEqual(before);
  });

  it('answers 400 on params.holdingId for a malformed id', async () => {
    const ctx = await setup();

    const response = await automatic(ctx.app, ctx.ana, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['params.holdingId'] });
  });

  it('answers 401 without a session', async () => {
    const ctx = await setup();

    const response = await automatic(ctx.app, '', MISSING_ID);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('answers the shared 500 without an amount in the log when the market reader fails', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    const failing = vi
      .spyOn(DrizzleMarketPriceReader.prototype, 'findMany')
      .mockRejectedValue(new Error('select "unit_price" from "crypto_market_prices" failed'));
    ctx.lines.length = 0;

    const switched = await automatic(ctx.app, ctx.ana, id);
    const fetched = await read(ctx.app, ctx.ana, id);
    failing.mockRestore();

    for (const response of [switched, fetched]) {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL' });
      expect(response.text).not.toMatch(/select|crypto_market_prices|unit_price|at /i);
    }
    for (const leaked of ['6400000', '6000000']) {
      expect(ctx.lines.join('\n')).not.toContain(leaked);
    }
    const stored = (await read(ctx.app, ctx.ana, id)).body as HoldingResponse;
    expect(stored.priceSource).toBe('manual');
  });
});
