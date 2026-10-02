import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createInvestmentsJobs,
  CoingeckoPriceProvider,
  FakePriceProvider,
} from '../../src/investments/jobs';
import { PriceSyncJob } from '../../src/investments/infrastructure/jobs/price-sync-job';
import { SnapshotJob } from '../../src/investments/infrastructure/jobs/snapshot-job';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../exchange-rates/fakes';
import { logEntries } from '../helpers/identity-harness';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { holdingPrice, insertHolding, insertPortfolio } from './fakes/price-db';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CREATED = new Date('2026-01-01T00:00:00.000Z');

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

async function seed(): Promise<{ holding: string; portfolio: string }> {
  const owner = await seedUser(connection, {
    email: 'ana@jobs.test',
    password: 'a-long-password-1',
    timeZone: 'UTC',
  });
  const portfolio = await insertPortfolio(connection.pool, owner, { createdAt: CREATED });
  const holding = await insertHolding(connection.pool, {
    portfolioId: portfolio,
    ownerId: owner,
    ticker: 'btc',
  });
  // A priced holding in a second portfolio, so the snapshot pass has something to store.
  const second = await insertPortfolio(connection.pool, owner, { createdAt: CREATED });
  await insertHolding(connection.pool, {
    portfolioId: second,
    ownerId: owner,
    ticker: 'eth',
    price: { unitPrice: 300_000n, source: 'manual', pricedAt: CREATED },
  });
  return { holding, portfolio: second };
}

async function snapshotCount(portfolio: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from portfolio_value_snapshots where portfolio_id = $1',
    [portfolio],
  );
  return Number(result.rows[0]?.n);
}

async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400 && !(await check()); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(await check()).toBe(true);
}

describe('createInvestmentsJobs', () => {
  it('starts both jobs and stop() waits for both passes', async () => {
    const { holding, portfolio } = await seed();
    const provider = new FakePriceProvider();
    const jobs = createInvestmentsJobs({
      db: connection.db,
      provider,
      logger: capturingLogger().logger,
      clock: new MutableClock(new Date('2026-03-02T12:00:00.000Z')),
    });

    jobs.start();
    // A stop requested before the price pass reaches the provider skips that call by design.
    await eventually(() => provider.calls === 1);
    await jobs.stop();

    expect(provider.calls).toBe(1);
    expect(await holdingPrice(connection.pool, holding)).toMatchObject({ source: 'automatic' });
    expect(await snapshotCount(portfolio)).toBe(1);
  });

  it('stop() does not resolve before a price pass still waiting on the provider', async () => {
    await seed();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakePriceProvider();
    const fetchPrices = provider.fetchPrices.bind(provider);
    provider.fetchPrices = async (symbols) => {
      const quotes = await fetchPrices(symbols);
      await gate;
      return quotes;
    };
    const jobs = createInvestmentsJobs({
      db: connection.db,
      provider,
      logger: capturingLogger().logger,
      clock: new MutableClock(),
    });

    jobs.start();
    await eventually(() => provider.calls === 1);
    let stopped = false;
    const stopping = jobs.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('stop() stops both jobs even when one stop rejects, then rethrows the first reason', async () => {
    const priceStop = vi
      .spyOn(PriceSyncJob.prototype, 'stop')
      .mockRejectedValue(new Error('price stop failed'));
    const slow = { settled: false };
    const snapshotStop = vi.spyOn(SnapshotJob.prototype, 'stop').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      slow.settled = true;
    });
    try {
      const jobs = createInvestmentsJobs({
        db: connection.db,
        provider: new FakePriceProvider(),
        logger: capturingLogger().logger,
        clock: new MutableClock(),
      });
      await expect(jobs.stop()).rejects.toThrow('price stop failed');
      expect(slow.settled).toBe(true);
      expect(priceStop).toHaveBeenCalledTimes(1);
      expect(snapshotStop).toHaveBeenCalledTimes(1);

      priceStop.mockResolvedValue(undefined);
      snapshotStop.mockRejectedValue(new Error('snapshot stop failed'));
      await expect(jobs.stop()).rejects.toThrow('snapshot stop failed');
      expect(priceStop).toHaveBeenCalledTimes(2);
    } finally {
      priceStop.mockRestore();
      snapshotStop.mockRestore();
    }
  });

  it('stopping twice is harmless, and so is stopping before starting', async () => {
    await seed();
    const jobs = createInvestmentsJobs({
      db: connection.db,
      provider: new FakePriceProvider(),
      logger: capturingLogger().logger,
      clock: new MutableClock(),
    });

    await jobs.stop();
    jobs.start();
    await jobs.stop();
    await expect(jobs.stop()).resolves.toBeUndefined();
  });

  it('the composition built with no API key starts and completes a pass (AC-15)', async () => {
    const { holding } = await seed();
    const requests: Headers[] = [];
    const fresh = new Date().toISOString();
    vi.stubGlobal('fetch', (_url: unknown, init?: RequestInit) => {
      requests.push(new Headers(init?.headers));
      return Promise.resolve(
        new Response(
          `[{"id":"bitcoin","symbol":"btc","current_price":67890.12,"market_cap_rank":1,"last_updated":"${fresh}"}]`,
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    const { lines, logger } = capturingLogger();
    const provider = new CoingeckoPriceProvider({
      baseUrl: 'https://coingecko.invalid/api/v3',
      apiKey: undefined,
    });
    const jobs = createInvestmentsJobs({
      db: connection.db,
      provider,
      logger,
      clock: new MutableClock(new Date()),
    });

    jobs.start();
    await eventually(() => requests.length === 1);
    await jobs.stop();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.has('x-cg-demo-api-key')).toBe(false);
    expect(await holdingPrice(connection.pool, holding)).toMatchObject({
      unitPrice: 6_789_012n,
      source: 'automatic',
    });
    expect(logEntries(lines).some((entry) => entry.level === 50)).toBe(false);
  });
});

describe('worker log lines', () => {
  const worker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');

  it('keeps the email worker started line the e2e server waits on, unchanged', () => {
    expect(worker).toContain(
      "logger.info({ provider: env.EMAIL_PROVIDER }, 'email worker started');",
    );
    const playwright = readFileSync(
      new URL('../../../../playwright.config.ts', import.meta.url),
      'utf8',
    );
    expect(playwright).toContain('/email worker started/');
  });

  it('keeps the rates sync line and adds the price and snapshot lines', () => {
    expect(worker).toContain("logger.info({ provider: env.RATE_PROVIDER }, 'rates sync started');");
    expect(worker).toContain("'price sync started'");
    expect(worker).toContain("'snapshot job started'");
  });

  it('starts the investments jobs and stops them on shutdown', () => {
    expect(worker).toContain('investmentsJobs.start();');
    expect(worker).toMatch(/Promise\.all\(\[[^\]]*investmentsJobs\.stop\(\)[^\]]*\]\)/);
  });

  it('logs once that it runs without a CoinGecko key, never the key', () => {
    expect(worker).toMatch(/COINGECKO_API_KEY/);
    expect(worker).toContain('without COINGECKO_API_KEY');
    const loggedCode = worker
      .split(String.fromCharCode(10))
      .filter((line) => line.includes('logger.'))
      .map((line) => line.replace(/'[^']*'/g, "''"));
    expect(loggedCode.join(' ')).not.toContain('COINGECKO_API_KEY');
  });
});
