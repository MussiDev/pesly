import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PortfolioResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInvestmentsRoutes } from '../../src/investments';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import { CoingeckoPriceProvider } from '../../src/investments/infrastructure/provider/coingecko-price-provider';
import { FakePriceProvider } from '../../src/investments/infrastructure/provider/fake-price-provider';
import { createPriceSyncJob, createSnapshotJob } from '../../src/investments/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../exchange-rates/fakes';
import { createIdentityHarness, logEntries } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { ScriptedPriceProvider } from './fakes/in-memory-prices';
import { holdingPrice, insertHolding, insertPortfolio } from './fakes/price-db';

/*
 * The worker side end to end on the real database: the real repositories, use cases and jobs, the
 * fake provider and a mutable clock; the read side goes through the real routes.
 */

let connection: DatabaseConnection;
const stubs: Server[] = [];

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

afterEach(async () => {
  for (const server of stubs.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = 'a long enough passphrase';
const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const SCALE = 100_000_000n;
const CREATED = new Date('2026-03-01T10:00:00.000Z');
const START = new Date('2026-03-01T22:00:00.000Z');
const LONG_AGO = new Date('2026-02-01T00:00:00.000Z');

// Fake provider prices, in US cents.
const BTC = 6_789_012n;
const ETH = 351_234n;
// Manual ETH prices around the 5% line: (m - 351,234) * 100 against m * 5.
const ETH_EXACTLY_5_PERCENT_ABOVE_MARKET = 369_720n;
const ETH_JUST_OVER_5_PERCENT_ABOVE_MARKET = 369_721n;

interface World {
  app: Express;
  clock: MutableClock;
  lines: string[];
  provider: FakePriceProvider;
  tick: () => Promise<void>;
  advanceTo: (target: Date) => Promise<void>;
}

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

function world(
  start: Date,
  provider: FakePriceProvider = new FakePriceProvider(),
  step = 5 * MINUTE,
): World {
  const clock = new MutableClock(start);
  const { lines, logger } = capturingLogger();
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createInvestmentsRoutes({ db: connection.db, clock, logger })],
  });
  const prices = createPriceSyncJob({ db: connection.db, provider, logger, clock });
  const snapshots = createSnapshotJob({ db: connection.db, logger, clock });
  const tick = async () => {
    await prices.runOnce();
    await snapshots.runOnce();
  };
  const advanceTo = async (target: Date) => {
    while (clock.now().getTime() < target.getTime()) {
      clock.advance(Math.min(step, target.getTime() - clock.now().getTime()));
      await tick();
    }
  };
  return { app: harness.app, clock, lines, provider, tick, advanceTo };
}

async function userIn(email: string, timeZone: string): Promise<string> {
  return seedUser(connection, { email, password: PASSWORD, timeZone });
}

async function sessionFor(app: Express, email: string): Promise<string> {
  return cookieHeader(sessionFrom(await signIn(app, email, PASSWORD)));
}

interface Seeded {
  owner: string;
  portfolio: string;
  btc: string;
  eth: string;
  cookie: string;
}

/**
 * A user with one portfolio: an unpriced BTC holding (automatic once refreshed), a manual ETH
 * holding and, optionally, an imported ARS stock.
 */
async function seedInvestor(
  w: { app: Express },
  email: string,
  timeZone: string,
  options: { btcQuantity: bigint; ethQuantity: bigint; ethManual: bigint; stock?: boolean },
): Promise<Seeded> {
  const owner = await userIn(email, timeZone);
  const portfolio = await insertPortfolio(connection.pool, owner, { createdAt: CREATED });
  const btc = await insertHolding(connection.pool, {
    portfolioId: portfolio,
    ownerId: owner,
    ticker: 'BTC',
    quantity: options.btcQuantity,
  });
  const eth = await insertHolding(connection.pool, {
    portfolioId: portfolio,
    ownerId: owner,
    ticker: 'ETH',
    quantity: options.ethQuantity,
    price: { unitPrice: options.ethManual, source: 'manual', pricedAt: LONG_AGO },
  });
  if (options.stock) {
    await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'AAPL',
      type: 'cedear',
      currency: 'ARS',
      quantity: 10n * SCALE,
      price: { unitPrice: 1_850_000n, source: 'import', pricedAt: LONG_AGO },
    });
  }
  return { owner, portfolio, btc, eth, cookie: await sessionFor(w.app, email) };
}

async function portfolioOf(w: World, seeded: Seeded): Promise<PortfolioResponse> {
  const response = await request(w.app)
    .get(`/investments/portfolios/${seeded.portfolio}`)
    .set('Cookie', seeded.cookie);
  expect(response.status).toBe(200);
  return response.body as PortfolioResponse;
}

function holdingOf(portfolio: PortfolioResponse, ticker: string) {
  const holding = portfolio.holdings.find((h) => h.ticker === ticker);
  if (!holding) throw new Error(`no ${ticker} holding in the response`);
  return holding;
}

async function marketPrices(): Promise<Record<string, { price: string; at: string }>> {
  const result = await connection.pool.query<{ symbol: string; price: string; at: Date }>(
    'select symbol, unit_price::text as price, priced_at as at from crypto_market_prices order by symbol',
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.symbol, { price: row.price, at: row.at.toISOString() }]),
  );
}

async function usage(): Promise<Record<string, number>> {
  const result = await connection.pool.query<{ month: string; calls: number }>(
    'select month, calls from crypto_price_usage order by month',
  );
  return Object.fromEntries(result.rows.map((row) => [row.month, row.calls]));
}

interface FailureRow {
  failed_at: Date;
  code: string;
  status_code: number | null;
  detail: string | null;
}

async function failures(): Promise<FailureRow[]> {
  const result = await connection.pool.query<FailureRow>(
    'select failed_at, code, status_code, detail from crypto_price_refresh_failures order by failed_at',
  );
  return result.rows;
}

interface SnapshotRow {
  portfolio_id: string;
  date: string;
  currency: string;
  total: string;
  taken_at: Date;
}

async function snapshots(portfolioId?: string): Promise<SnapshotRow[]> {
  const result = await connection.pool.query<SnapshotRow>(
    `select portfolio_id, to_char(snapshot_date, 'YYYY-MM-DD') as date, currency,
            total_value::text as total, taken_at
     from portfolio_value_snapshots
     where $1::uuid is null or portfolio_id = $1::uuid
     order by snapshot_date, currency`,
    [portfolioId ?? null],
  );
  return result.rows;
}

const totalsOf = (rows: { currency: string; value?: string; total?: string }[]) =>
  Object.fromEntries(rows.map((row) => [row.currency, row.value ?? row.total]));

describe('price and snapshot jobs on the real database', () => {
  it('runs a 24 hour cycle: refresh, outage, recovery and local midnight in two zones (AC-01, AC-02, AC-03, AC-05, AC-07, AC-09)', async () => {
    const provider = new FakePriceProvider();
    const w = world(START, provider);
    const ana = await seedInvestor(w, 'ana@cycle.test', 'UTC', {
      btcQuantity: SCALE,
      ethQuantity: 2n * SCALE,
      ethManual: ETH_JUST_OVER_5_PERCENT_ABOVE_MARKET,
      stock: true,
    });
    const bob = await seedInvestor(w, 'bob@cycle.test', BUENOS_AIRES, {
      btcQuantity: SCALE / 2n,
      ethQuantity: SCALE,
      ethManual: ETH_EXACTLY_5_PERCENT_ABOVE_MARKET,
    });
    const manualEth = { source: 'manual', pricedAt: LONG_AGO };

    // 22:00Z: the first refresh prices the unpriced crypto holdings and keeps the manual ones.
    await w.tick();
    for (const { btc, eth } of [ana, bob]) {
      expect(await holdingPrice(connection.pool, btc)).toMatchObject({
        unitPrice: BTC,
        source: 'automatic',
        pricedAt: START,
      });
      expect(await holdingPrice(connection.pool, eth)).toMatchObject(manualEth);
    }
    expect((await holdingPrice(connection.pool, ana.eth)).unitPrice).toBe(
      ETH_JUST_OVER_5_PERCENT_ABOVE_MARKET,
    );
    expect(await marketPrices()).toEqual({
      btc: { price: BTC.toString(), at: START.toISOString() },
      eth: { price: ETH.toString(), at: START.toISOString() },
    });
    expect(await usage()).toEqual({ '2026-03': 1 });
    expect(provider.calls).toBe(1);
    expect(await failures()).toEqual([]);
    expect(await snapshots()).toEqual([]);

    // The read model: more than 5% away warns, exactly 5% does not (AC-07, AC-09).
    const anaView = await portfolioOf(w, ana);
    expect(holdingOf(anaView, 'ETH')).toMatchObject({
      priceSource: 'manual',
      marketUnitPrice: ETH.toString(),
      marketPriceDiffers: true,
      marketPriceRecent: true,
    });
    expect(holdingOf(anaView, 'BTC')).toMatchObject({
      priceSource: 'automatic',
      value: BTC.toString(),
      marketPriceDiffers: false,
    });
    expect(holdingOf(await portfolioOf(w, bob), 'ETH')).toMatchObject({
      marketUnitPrice: ETH.toString(),
      marketPriceDiffers: false,
      marketPriceRecent: true,
    });

    // Outage from 23:00Z: nothing is called before the hour, then one call fails per attempt.
    provider.failWith(
      new PriceProviderFailure('provider_timeout', { detail: 'request timed out' }),
    );
    await w.advanceTo(new Date('2026-03-01T22:55:00.000Z'));
    expect(provider.calls).toBe(1);
    await w.advanceTo(new Date('2026-03-01T23:00:00.000Z'));
    expect(provider.calls).toBe(2);
    expect(await usage()).toEqual({ '2026-03': 2 });
    expect(await failures()).toHaveLength(1);
    expect((await failures())[0]).toMatchObject({ code: 'provider_timeout', status_code: null });
    // The retry is 15 minutes later, not sooner.
    await w.advanceTo(new Date('2026-03-01T23:10:00.000Z'));
    expect(provider.calls).toBe(2);
    await w.advanceTo(new Date('2026-03-01T23:15:00.000Z'));
    expect(provider.calls).toBe(3);
    expect(await usage()).toEqual({ '2026-03': 3 });
    expect(await failures()).toHaveLength(2);
    // The second failure backs off 30 minutes.
    await w.advanceTo(new Date('2026-03-01T23:40:00.000Z'));
    expect(provider.calls).toBe(3);

    // Prices stayed as they were all along the outage.
    for (const { btc, eth } of [ana, bob]) {
      expect(await holdingPrice(connection.pool, btc)).toMatchObject({
        unitPrice: BTC,
        source: 'automatic',
        pricedAt: START,
      });
      expect(await holdingPrice(connection.pool, eth)).toMatchObject(manualEth);
    }
    expect((await marketPrices()).btc?.at).toBe(START.toISOString());

    // Recovery at 23:45Z.
    provider.recover();
    await w.advanceTo(new Date('2026-03-01T23:45:00.000Z'));
    const recoveredAt = new Date('2026-03-01T23:45:00.000Z');
    expect(provider.calls).toBe(4);
    expect(await usage()).toEqual({ '2026-03': 4 });
    expect(await failures()).toHaveLength(2);
    expect(await holdingPrice(connection.pool, ana.btc)).toMatchObject({
      source: 'automatic',
      pricedAt: recoveredAt,
    });

    // UTC midnight: only the UTC portfolio has a finished local day (Bob's is still 21:xx on the 1st).
    await w.advanceTo(new Date('2026-03-01T23:55:00.000Z'));
    expect(await snapshots()).toEqual([]);
    await w.advanceTo(new Date('2026-03-02T00:00:00.000Z'));
    const anaRows = await snapshots(ana.portfolio);
    expect(anaRows.map((row) => `${row.date} ${row.currency} ${row.total}`)).toEqual([
      '2026-03-01 ARS 18500000',
      '2026-03-01 USD 7528454',
    ]);
    expect(await snapshots(bob.portfolio)).toEqual([]);
    const anaAfterMidnight = await portfolioOf(w, ana);
    expect(totalsOf(anaRows)).toEqual(totalsOf(anaAfterMidnight.totals));

    // A rerun of the pass changes nothing, whenever it happens.
    await w.advanceTo(new Date('2026-03-02T00:20:00.000Z'));
    expect(await snapshots(ana.portfolio)).toEqual(anaRows);

    // Buenos Aires midnight is 03:00Z.
    await w.advanceTo(new Date('2026-03-02T02:55:00.000Z'));
    expect(await snapshots(bob.portfolio)).toEqual([]);
    await w.advanceTo(new Date('2026-03-02T03:00:00.000Z'));
    const bobRows = await snapshots(bob.portfolio);
    expect(bobRows.map((row) => `${row.date} ${row.currency} ${row.total}`)).toEqual([
      '2026-03-01 USD 3764226',
    ]);
    expect(totalsOf(bobRows)).toEqual(totalsOf((await portfolioOf(w, bob)).totals));

    // The rest of the day: the hourly refreshes continue, one call reserved per call made.
    await w.advanceTo(new Date(START.getTime() + DAY));
    expect(await snapshots(ana.portfolio)).toHaveLength(2);
    expect(await snapshots(bob.portfolio)).toHaveLength(1);
    expect(await snapshots()).toHaveLength(3);
    expect(await usage()).toEqual({ '2026-03': provider.calls });
    // Exactly 26 calls: 22:00 (start), 23:00 (fails), 23:15 (fails after 15 min), 23:45 (fails
    // again after 30 min; this is the recovery), then one per hour after each success, 00:45 to
    // 21:45 inclusive (22 calls). The 5 minute step visits every one of those instants and the
    // next hourly call (22:45) is past the end of the day.
    expect(provider.calls).toBe(26);
    expect(await failures()).toHaveLength(2);
    for (const { eth } of [ana, bob]) {
      expect(await holdingPrice(connection.pool, eth)).toMatchObject(manualEth);
    }
  }, 120_000);

  it('keeps a manual price while the stored market price moves and flags it by the 5% rule (AC-05, AC-07, AC-09)', async () => {
    const provider = new ScriptedPriceProvider();
    const clock = new MutableClock(START);
    const { lines, logger } = capturingLogger();
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [createInvestmentsRoutes({ db: connection.db, clock, logger })],
    });
    const w = { app: harness.app };
    const ana = await seedInvestor(w, 'ana@manual.test', 'UTC', {
      btcQuantity: SCALE,
      ethQuantity: SCALE,
      ethManual: 1_000_000n,
    });
    const job = createPriceSyncJob({ db: connection.db, provider, logger, clock });
    const view = async () =>
      holdingOf(
        (
          await request(harness.app)
            .get(`/investments/portfolios/${ana.portfolio}`)
            .set('Cookie', ana.cookie)
        ).body as PortfolioResponse,
        'ETH',
      );
    const refresh = async (price: bigint) => {
      clock.advance(HOUR);
      provider.prices.set('eth', price);
      provider.prices.set('btc', BTC);
      expect(await job.runOnce()).toMatchObject({ outcome: 'refreshed' });
    };

    // 6.67% away: warns; the manual price is not replaced.
    await refresh(1_066_700n);
    expect(await holdingPrice(connection.pool, ana.eth)).toMatchObject({
      unitPrice: 1_000_000n,
      source: 'manual',
      pricedAt: LONG_AGO,
    });
    expect(await view()).toMatchObject({
      unitPrice: '1000000',
      marketUnitPrice: '1066700',
      marketPriceDiffers: true,
      marketPriceRecent: true,
    });
    // Exactly 5% above or below the manual price: no warning.
    await refresh(1_050_000n);
    expect((await marketPrices()).eth?.price).toBe('1050000');
    expect(await view()).toMatchObject({ marketUnitPrice: '1050000', marketPriceDiffers: false });
    await refresh(950_000n);
    expect(await view()).toMatchObject({ marketUnitPrice: '950000', marketPriceDiffers: false });
    // One cent past the line on each side: warns again.
    await refresh(1_050_001n);
    expect(await view()).toMatchObject({ marketPriceDiffers: true });
    await refresh(949_999n);
    expect(await view()).toMatchObject({ marketUnitPrice: '949999', marketPriceDiffers: true });
    expect(await holdingPrice(connection.pool, ana.eth)).toMatchObject({
      unitPrice: 1_000_000n,
      source: 'manual',
    });
    // The unpriced holding of the same user kept being priced automatically.
    expect(await holdingPrice(connection.pool, ana.btc)).toMatchObject({ source: 'automatic' });
    expect(lines.join('')).not.toMatch(/1066700|949999/);
  });

  it('flags a manual price against a 30 day old market price, with marketPriceRecent false, and keeps the counter under 1,000 across a month (AC-16, NFR-01)', async () => {
    const provider = new FakePriceProvider();
    const start = new Date('2026-03-01T00:00:00.000Z');
    const w = world(start, provider, 15 * MINUTE);
    const ana = await seedInvestor(w, 'ana@month.test', 'UTC', {
      btcQuantity: SCALE,
      ethQuantity: SCALE,
      ethManual: ETH_JUST_OVER_5_PERCENT_ABOVE_MARKET,
    });

    // Three healthy days, then the provider is down for the rest of the month.
    await w.advanceTo(new Date(start.getTime() + 3 * DAY));
    const lastMarketAt = (await marketPrices()).eth?.at;
    expect(lastMarketAt).toBeDefined();
    provider.failWith(new PriceProviderFailure('provider_rate_limited', { statusCode: 429 }));
    const monthEnd = new Date('2026-03-31T23:45:00.000Z');
    await w.advanceTo(monthEnd);

    // Never more than 1,000 calls in the month, and one reserved per call made.
    const counter = await usage();
    expect(counter['2026-03']).toBe(provider.calls);
    // The count is deterministic (our clock; the first tick, at 00:15, makes the first call).
    // Hours are counted from the start, 03-01 00:00Z:
    // - healthy: one call an hour at 0:15, 1:15 ... 71:15 is 72 calls (the next is due at 72:15);
    // - outage: fails at 72:15 (retry in 15 min), 72:30 (retry in 30 min) and 73:00 (retry in 60
    //   min, the ceiling), then one failed attempt an hour at 74:00 ... 743:00 is 670 calls
    //   (the month ends at 743:45, and 744:00 is already April).
    // 72 + 3 + 670 = 745.
    expect(provider.calls).toBe(745);
    expect(provider.calls).toBeLessThanOrEqual(1_000);

    // The market price is about 28 days old, then a bit over 30 days: still flagged, no longer recent.
    await w.advanceTo(new Date('2026-04-01T00:15:00.000Z'));
    const stale = await portfolioOf(w, ana);
    expect(holdingOf(stale, 'ETH')).toMatchObject({
      priceSource: 'manual',
      marketUnitPrice: ETH.toString(),
      marketPriceDiffers: true,
      marketPriceRecent: false,
    });
    const age = w.clock.now().getTime() - new Date(lastMarketAt ?? 0).getTime();
    expect(age).toBeGreaterThan(28 * DAY);
    expect((await usage())['2026-04']).toBeLessThanOrEqual(1_000);
    // The automatic holding kept its last price, which is also old.
    expect(holdingOf(stale, 'BTC')).toMatchObject({ priceSource: 'automatic', priceStale: true });
  }, 240_000);

  it('never writes provider text or the API key to the failure log or the log (NFR-01, NFR-02)', async () => {
    const key = 'CG-demo-secret-key-0123456789';
    const providerText = 'upstream said: quota exceeded for account 9f3c-SECRET';
    const seenKeys: (string | string[] | undefined)[] = [];
    const server = createServer((req, res) => {
      seenKeys.push(req.headers['x-cg-demo-api-key']);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: providerText }));
    });
    stubs.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const clock = new MutableClock(START);
    const { lines, logger } = capturingLogger();
    const owner = await userIn('ana@leak.test', 'UTC');
    const portfolio = await insertPortfolio(connection.pool, owner, { createdAt: CREATED });
    const btc = await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'BTC',
    });
    const job = createPriceSyncJob({
      db: connection.db,
      provider: new CoingeckoPriceProvider({
        baseUrl: `http://127.0.0.1:${port}/api/v3`,
        apiKey: key,
        now: () => clock.now(),
      }),
      logger,
      clock,
    });

    expect(await job.runOnce()).toEqual({ outcome: 'failed', code: 'provider_bad_status' });
    clock.advance(HOUR);
    expect(await job.runOnce()).toEqual({ outcome: 'failed', code: 'provider_bad_status' });

    expect(seenKeys).toEqual([key, key]);
    const rows = await failures();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.code === 'provider_bad_status' && row.status_code === 500)).toBe(
      true,
    );
    const stored = JSON.stringify(rows);
    for (const secret of [key, 'SECRET', 'quota', 'upstream']) {
      expect(stored).not.toContain(secret);
      expect(lines.join('')).not.toContain(secret);
    }
    expect(logEntries(lines).some((entry) => entry.msg === 'crypto price refresh failed')).toBe(
      true,
    );
    expect(await holdingPrice(connection.pool, btc)).toMatchObject({
      unitPrice: null,
      source: null,
    });
    expect(await usage()).toEqual({ '2026-03': 2 });
  });

  it('skips a portfolio whose total is above the 64 bit limit and snapshots the others (AC-04, NFR-01)', async () => {
    const clock = new MutableClock(new Date('2026-03-02T12:00:00.000Z'));
    const { lines, logger } = capturingLogger();
    const job = createSnapshotJob({ db: connection.db, logger, clock });

    const huge = await userIn('huge@overflow.test', 'UTC');
    const hugePortfolio = await insertPortfolio(connection.pool, huge, { createdAt: CREATED });
    // The largest quantity and unit price the contracts allow: 10^18 * 10^12 / 10^8 is above 2^63 - 1.
    await insertHolding(connection.pool, {
      portfolioId: hugePortfolio,
      ownerId: huge,
      ticker: 'BTC',
      quantity: 10n ** 18n,
      price: { unitPrice: 10n ** 12n, source: 'manual', pricedAt: LONG_AGO },
    });
    const normal = await userIn('normal@overflow.test', 'UTC');
    const normalPortfolio = await insertPortfolio(connection.pool, normal, { createdAt: CREATED });
    await insertHolding(connection.pool, {
      portfolioId: normalPortfolio,
      ownerId: normal,
      ticker: 'ETH',
      price: { unitPrice: ETH, source: 'manual', pricedAt: LONG_AGO },
    });
    const bob = await userIn('bob@overflow.test', BUENOS_AIRES);
    const bobPortfolio = await insertPortfolio(connection.pool, bob, { createdAt: CREATED });
    await insertHolding(connection.pool, {
      portfolioId: bobPortfolio,
      ownerId: bob,
      ticker: 'SOL',
      price: { unitPrice: 15_432n, source: 'manual', pricedAt: LONG_AGO },
    });

    const result = await job.runOnce();

    expect(result).toMatchObject({ saved: 2, skippedOutOfRange: 1, skippedZones: 0 });
    expect(await snapshots(hugePortfolio)).toEqual([]);
    expect(
      (await snapshots(normalPortfolio)).map((r) => `${r.date} ${r.currency} ${r.total}`),
    ).toEqual(['2026-03-01 USD 351234']);
    expect(
      (await snapshots(bobPortfolio)).map((r) => `${r.date} ${r.currency} ${r.total}`),
    ).toEqual(['2026-03-01 USD 15432']);
    const skipped = logEntries(lines).filter(
      (entry) => entry.msg === 'snapshot skipped: total out of range',
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ portfolioId: hugePortfolio, date: '2026-03-01' });
    expect(lines.join('')).not.toContain('1000000000000');

    // Later passes keep skipping it and keep the others once.
    expect(await job.runOnce()).toMatchObject({ saved: 0, skippedOutOfRange: 1 });
    expect(await snapshots()).toHaveLength(2);
  });
});
