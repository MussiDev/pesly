import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefreshCryptoPrices } from '../../src/investments/application/refresh-crypto-prices';
import { PriceProviderFailure } from '../../src/investments/domain/price-failure';
import { DrizzlePriceFailureLog } from '../../src/investments/infrastructure/db/drizzle-price-failure-log';
import {
  PRICE_POLL_INTERVAL_MS,
  PriceSyncJob,
} from '../../src/investments/infrastructure/jobs/price-sync-job';
import { FakePriceProvider } from '../../src/investments/infrastructure/provider/fake-price-provider';
import { createPriceSyncJob } from '../../src/investments/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../exchange-rates/fakes';
import { logEntries } from '../helpers/identity-harness';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  InMemoryCryptoPrices,
  InMemoryPriceFailureLog,
  InMemoryPriceSchedule,
  ScriptedPriceProvider,
} from './fakes/in-memory-prices';
import { holdingPrice, insertHolding, insertPortfolio } from './fakes/price-db';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}

async function seedPortfolio(): Promise<{ owner: string; portfolio: string }> {
  const owner = await seedUser(connection, {
    email: 'ana@price-job.test',
    password: 'a-long-password-1',
  });
  return { owner, portfolio: await insertPortfolio(connection.pool, owner) };
}

async function failureCount(): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from crypto_price_refresh_failures',
  );
  return Number(result.rows[0]?.n);
}

describe('PriceSyncJob', () => {
  it('polls every 30 seconds', () => {
    expect(PRICE_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('a pass refreshes a crypto holding to source automatic (AC-01) and logs counts only', async () => {
    const { owner, portfolio } = await seedPortfolio();
    const btc = await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'BTC',
    });
    const { lines, logger } = capturingLogger();
    const job = createPriceSyncJob({
      db: connection.db,
      provider: new FakePriceProvider(),
      logger,
      clock: new MutableClock(),
    });

    const outcome = await job.runOnce();

    expect(outcome).toMatchObject({ outcome: 'refreshed', markets: 1, updated: 1 });
    expect(await holdingPrice(connection.pool, btc)).toMatchObject({
      unitPrice: 6_789_012n,
      source: 'automatic',
    });
    expect(logEntries(lines).map((entry) => entry.msg)).toContain('crypto prices refreshed');
    expect(lines.join('')).not.toMatch(/6789012/);
  });

  it('leaves a manual-priced holding untouched while storing its market price (AC-05)', async () => {
    const { owner, portfolio } = await seedPortfolio();
    const pricedAt = new Date('2026-10-01T12:00:00.000Z');
    const eth = await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'eth',
      price: { unitPrice: 6_000_000n, source: 'manual', pricedAt },
    });
    const job = createPriceSyncJob({
      db: connection.db,
      provider: new FakePriceProvider(),
      logger: capturingLogger().logger,
      clock: new MutableClock(),
    });

    await job.runOnce();

    expect(await holdingPrice(connection.pool, eth)).toMatchObject({
      unitPrice: 6_000_000n,
      source: 'manual',
      pricedAt,
    });
    const market = await connection.pool.query<{ unit_price: string }>(
      "select unit_price from crypto_market_prices where symbol = 'eth'",
    );
    expect(market.rows[0]?.unit_price).toBe('351234');
  });

  it('a provider failure keeps the price and the next pass inside the retry delay makes no call (AC-02)', async () => {
    const { owner, portfolio } = await seedPortfolio();
    const btc = await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'btc',
    });
    const { lines, logger } = capturingLogger();
    const clock = new MutableClock();
    const provider = new FakePriceProvider();
    const job = createPriceSyncJob({ db: connection.db, provider, logger, clock });
    await job.runOnce();
    const before = await holdingPrice(connection.pool, btc);

    clock.advance(60 * MINUTE);
    provider.failWith(
      new PriceProviderFailure('provider_timeout', { detail: 'secret provider text' }),
    );
    expect(await job.runOnce()).toEqual({ outcome: 'failed', code: 'provider_timeout' });
    expect(provider.calls).toBe(2);
    expect(await holdingPrice(connection.pool, btc)).toEqual(before);
    expect(await failureCount()).toBe(1);
    const failed = logEntries(lines).find((entry) => entry.msg === 'crypto price refresh failed');
    expect(failed).toMatchObject({ code: 'provider_timeout' });
    expect(lines.join('')).not.toContain('secret provider text');

    clock.advance(14 * MINUTE);
    expect(await job.runOnce()).toEqual({ outcome: 'not_due' });
    expect(provider.calls).toBe(2);
  });

  it('the failure purge removes records older than 30 days and runs at most hourly', async () => {
    const clock = new MutableClock();
    const log = new DrizzlePriceFailureLog(connection.db);
    const now = clock.now().getTime();
    await log.record({ at: new Date(now - 31 * DAY), code: 'provider_timeout' });
    await log.record({ at: new Date(now - 29 * DAY), code: 'provider_timeout' });
    const job = createPriceSyncJob({
      db: connection.db,
      provider: new FakePriceProvider(),
      logger: capturingLogger().logger,
      clock,
    });

    await job.runOnce();
    expect(await failureCount()).toBe(1);

    await log.record({ at: new Date(now - 32 * DAY), code: 'provider_timeout' });
    clock.advance(59 * MINUTE);
    await job.runOnce();
    expect(await failureCount()).toBe(2);

    clock.advance(MINUTE);
    await job.runOnce();
    expect(await failureCount()).toBe(1);
  });

  describe('with in-memory ports', () => {
    function build(provider: ScriptedPriceProvider) {
      const prices = new InMemoryCryptoPrices();
      prices.addHolding('btc');
      provider.prices.set('btc', 6_789_012n);
      const schedule = new InMemoryPriceSchedule();
      const failures = new InMemoryPriceFailureLog();
      const clock = new MutableClock();
      const { lines, logger } = capturingLogger();
      const refresh = new RefreshCryptoPrices({ provider, prices, schedule, failures, clock });
      const job = new PriceSyncJob({ refresh, failures, clock, logger, pollIntervalMs: 5 });
      return { job, prices, schedule, failures, lines };
    }

    it('a failing storage layer is logged with the error and the next pass still runs', async () => {
      const provider = new ScriptedPriceProvider();
      const { job, prices, schedule, lines } = build(provider);
      prices.applyError = new Error('connection lost');
      const originalApply = prices.storeAndApply.bind(prices);
      prices.storeAndApply = async (...args) => {
        try {
          return await originalApply(...args);
        } catch (error) {
          prices.applyError = null;
          schedule.nextAttemptAt = null;
          throw error;
        }
      };

      job.start();
      await eventually(() => prices.markets.has('btc'));
      await job.stop();

      const errored = logEntries(lines).find((e) => e.msg === 'crypto price refresh errored');
      expect(errored).toBeDefined();
      expect(JSON.stringify(errored?.err)).toContain('connection lost');
      expect(provider.calls).toBeGreaterThanOrEqual(2);
    });

    it('a failing purge is logged and does not stop the refresh', async () => {
      const provider = new ScriptedPriceProvider();
      const { job, failures, prices, lines } = build(provider);
      failures.purgeOlderThan = () => Promise.reject(new Error('purge broke'));

      await job.runOnce();

      expect(prices.markets.has('btc')).toBe(true);
      expect(logEntries(lines).some((e) => e.msg === 'crypto price failure purge failed')).toBe(
        true,
      );
    });

    it('stop() waits for the pass in progress and starts no further provider call', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const provider = new ScriptedPriceProvider();
      const fetchPrices = provider.fetchPrices.bind(provider);
      provider.fetchPrices = async (symbols) => {
        const quotes = await fetchPrices(symbols);
        await gate;
        return quotes;
      };
      const { job, prices, schedule } = build(provider);

      job.start();
      await eventually(() => provider.calls === 1);
      let stopped = false;
      const stopping = job.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(stopped).toBe(false);
      release();
      await stopping;

      expect(prices.markets.has('btc')).toBe(true);
      expect(schedule.lastSuccessAt).not.toBeNull();
      schedule.nextAttemptAt = null;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(provider.calls).toBe(1);
    });
  });
});
