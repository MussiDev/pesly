import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleCryptoPriceRepository } from '../../src/investments/infrastructure/db/drizzle-crypto-price-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { holdingPrice, insertHolding, insertPortfolio, sqlState } from './fakes/price-db';

let connection: DatabaseConnection;
let repository: DrizzleCryptoPriceRepository;
let owner: string;
let portfolio: string;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleCryptoPriceRepository(connection.db);
});

beforeEach(async () => {
  owner = await seedUser(connection, { email: 'ana@prices.test', password: 'a-long-password-1' });
  portfolio = await insertPortfolio(connection.pool, owner);
});

afterAll(async () => {
  await connection.pool.end();
});

const T0 = new Date('2026-10-02T10:00:00.000Z');
const T1 = new Date('2026-10-02T11:00:00.000Z');
const T2 = new Date('2026-10-02T12:00:00.000Z');
const hoursBefore = (date: Date, hours: number) => new Date(date.getTime() - hours * 3_600_000);

async function marketPrices(): Promise<Record<string, { unitPrice: bigint; pricedAt: Date }>> {
  const result = await connection.pool.query<{
    symbol: string;
    unit_price: string;
    priced_at: Date;
  }>('select symbol, unit_price, priced_at from crypto_market_prices order by symbol');
  return Object.fromEntries(
    result.rows.map((row) => [
      row.symbol,
      { unitPrice: BigInt(row.unit_price), pricedAt: row.priced_at },
    ]),
  );
}

function crypto(ticker: string, price?: Parameters<typeof insertHolding>[1]['price']) {
  return insertHolding(connection.pool, {
    portfolioId: portfolio,
    ownerId: owner,
    ticker,
    ...(price ? { price } : {}),
  });
}

describe('DrizzleCryptoPriceRepository.storeAndApply', () => {
  it('stores one market price per symbol and prices only crypto USD holdings of the answered symbols, ignoring case', async () => {
    const btc = await crypto('BTC');
    const eth = await crypto('Eth');
    const sol = await crypto('SOL');
    const stockBtc = await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'btc-stock',
      type: 'stock',
      currency: 'ARS',
    });
    const otherOwner = await seedUser(connection, {
      email: 'bob@prices.test',
      password: 'a-long-password-1',
    });
    const bobPortfolio = await insertPortfolio(connection.pool, otherOwner);
    const bobBtc = await insertHolding(connection.pool, {
      portfolioId: bobPortfolio,
      ownerId: otherOwner,
      ticker: 'btc',
    });

    const result = await repository.storeAndApply(
      [
        { symbol: 'btc', unitPrice: 6_789_012n },
        { symbol: 'eth', unitPrice: 250_000n },
      ],
      T1,
    );

    expect(result).toEqual({ markets: 2, holdings: 3 });
    expect(await marketPrices()).toEqual({
      btc: { unitPrice: 6_789_012n, pricedAt: T1 },
      eth: { unitPrice: 250_000n, pricedAt: T1 },
    });
    for (const [id, unitPrice] of [
      [btc, 6_789_012n],
      [bobBtc, 6_789_012n],
      [eth, 250_000n],
    ] as const) {
      const price = await holdingPrice(connection.pool, id);
      expect(price).toMatchObject({ unitPrice, source: 'automatic', pricedAt: T1 });
    }
    expect(await holdingPrice(connection.pool, sol)).toMatchObject({
      unitPrice: null,
      source: null,
      pricedAt: null,
    });
    expect(await holdingPrice(connection.pool, stockBtc)).toMatchObject({
      unitPrice: null,
      source: null,
    });
  });

  it('touches updated_at only on the holdings it prices', async () => {
    const priced = await crypto('btc');
    const untouched = await crypto('sol');
    const before = await holdingPrice(connection.pool, untouched);

    await repository.storeAndApply([{ symbol: 'btc', unitPrice: 100n }], T1);

    expect((await holdingPrice(connection.pool, priced)).updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect((await holdingPrice(connection.pool, untouched)).updatedAt).toEqual(before.updatedAt);
  });

  it('keeps the price, source and time of a manual holding while the market price is stored (AC-05)', async () => {
    const manual = await crypto('btc', {
      unitPrice: 6_000_000n,
      source: 'manual',
      pricedAt: hoursBefore(T1, 48),
    });

    const result = await repository.storeAndApply([{ symbol: 'btc', unitPrice: 6_789_012n }], T1);

    expect(result).toEqual({ markets: 1, holdings: 0 });
    expect(await holdingPrice(connection.pool, manual)).toMatchObject({
      unitPrice: 6_000_000n,
      source: 'manual',
      pricedAt: hoursBefore(T1, 48),
    });
    expect(await marketPrices()).toEqual({ btc: { unitPrice: 6_789_012n, pricedAt: T1 } });
  });

  it('prices a holding added after the market price and one whose price was cleared, at the next apply', async () => {
    await crypto('btc');
    await repository.storeAndApply([{ symbol: 'btc', unitPrice: 6_789_012n }], T1);
    const added = await crypto('eth');
    const lateBtc = await insertHolding(connection.pool, {
      portfolioId: await insertPortfolio(connection.pool, owner, { name: 'Binance' }),
      ownerId: owner,
      ticker: 'btc',
    });
    const cleared = await crypto('sol', {
      unitPrice: 1n,
      source: 'automatic',
      pricedAt: hoursBefore(T1, 1),
    });
    await repository.storeAndApply([{ symbol: 'sol', unitPrice: 15_000n }], T1);
    await connection.pool.query(
      'update holdings set unit_price = null, price_source = null, priced_at = null where id = $1',
      [cleared],
    );

    // The apply reads the stored table, so the already stored btc price reaches the new holding
    // even though btc was answered in an earlier cycle: it is answered again here.
    const result = await repository.storeAndApply(
      [
        { symbol: 'btc', unitPrice: 6_789_012n },
        { symbol: 'sol', unitPrice: 15_000n },
      ],
      T1,
    );

    expect(result).toEqual({ markets: 0, holdings: 2 });
    expect(await holdingPrice(connection.pool, lateBtc)).toMatchObject({
      unitPrice: 6_789_012n,
      source: 'automatic',
      pricedAt: T1,
    });
    expect(await holdingPrice(connection.pool, cleared)).toMatchObject({
      unitPrice: 15_000n,
      source: 'automatic',
      pricedAt: T1,
    });
    expect(await holdingPrice(connection.pool, added)).toMatchObject({ unitPrice: null });
  });

  it('replaces an imported price older than the market price and keeps a price that is not older', async () => {
    const imported = await crypto('btc', {
      unitPrice: 5_000_000n,
      source: 'import',
      pricedAt: hoursBefore(T1, 5),
    });
    const sameTime = await crypto('eth', { unitPrice: 200_000n, source: 'import', pricedAt: T1 });
    const newer = await crypto('sol', {
      unitPrice: 14_000n,
      source: 'automatic',
      pricedAt: T2,
    });

    const result = await repository.storeAndApply(
      [
        { symbol: 'btc', unitPrice: 6_789_012n },
        { symbol: 'eth', unitPrice: 250_000n },
        { symbol: 'sol', unitPrice: 15_000n },
      ],
      T1,
    );

    expect(result).toEqual({ markets: 3, holdings: 1 });
    expect(await holdingPrice(connection.pool, imported)).toMatchObject({
      unitPrice: 6_789_012n,
      source: 'automatic',
      pricedAt: T1,
    });
    expect(await holdingPrice(connection.pool, sameTime)).toMatchObject({
      unitPrice: 200_000n,
      source: 'import',
    });
    expect(await holdingPrice(connection.pool, newer)).toMatchObject({
      unitPrice: 14_000n,
      pricedAt: T2,
    });
  });

  it('never replaces a newer stored market price with an older one, and does not price from it', async () => {
    const holding = await crypto('btc');
    await repository.storeAndApply([{ symbol: 'btc', unitPrice: 6_800_000n }], T1);

    const stale = await repository.storeAndApply([{ symbol: 'btc', unitPrice: 1_000_000n }], T0);
    const same = await repository.storeAndApply([{ symbol: 'btc', unitPrice: 2_000_000n }], T1);

    expect(stale).toEqual({ markets: 0, holdings: 0 });
    expect(same).toEqual({ markets: 0, holdings: 0 });
    expect(await marketPrices()).toEqual({ btc: { unitPrice: 6_800_000n, pricedAt: T1 } });
    expect(await holdingPrice(connection.pool, holding)).toMatchObject({ unitPrice: 6_800_000n });

    const newer = await repository.storeAndApply([{ symbol: 'btc', unitPrice: 7_000_000n }], T2);

    expect(newer).toEqual({ markets: 1, holdings: 1 });
    expect(await holdingPrice(connection.pool, holding)).toMatchObject({
      unitPrice: 7_000_000n,
      pricedAt: T2,
    });
  });

  it('stores the market price of a symbol nobody holds and prices nothing', async () => {
    expect(await repository.storeAndApply([{ symbol: 'doge', unitPrice: 12n }], T1)).toEqual({
      markets: 1,
      holdings: 0,
    });
    expect(await marketPrices()).toEqual({ doge: { unitPrice: 12n, pricedAt: T1 } });
  });

  it('does nothing and runs no statement for an empty answer', async () => {
    expect(await repository.storeAndApply([], T1)).toEqual({ markets: 0, holdings: 0 });
    expect(await marketPrices()).toEqual({});
  });

  it('collapses a symbol repeated in one answer instead of failing the whole transaction', async () => {
    await crypto('btc');

    const result = await repository.storeAndApply(
      [
        { symbol: 'btc', unitPrice: 1_000n },
        { symbol: 'btc', unitPrice: 2_000n },
      ],
      T1,
    );

    expect(result).toEqual({ markets: 1, holdings: 1 });
    expect(await marketPrices()).toEqual({ btc: { unitPrice: 2_000n, pricedAt: T1 } });
  });

  it('binds values as parameters: a hostile symbol is rejected by the symbol check, never executed', async () => {
    await expect(
      repository.storeAndApply([{ symbol: "x'); drop table holdings; --", unitPrice: 1n }], T1),
    ).rejects.toThrow();

    expect(await sqlState(connection.pool, 'select 1 from holdings limit 1')).toBeUndefined();
  });

  it('rejects a market price of 0 or above 10^12 and leaves the whole transaction undone', async () => {
    const holding = await crypto('eth');

    await expect(
      repository.storeAndApply(
        [
          { symbol: 'eth', unitPrice: 5n },
          { symbol: 'btc', unitPrice: 0n },
        ],
        T1,
      ),
    ).rejects.toThrow();
    await expect(
      repository.storeAndApply([{ symbol: 'btc', unitPrice: 10n ** 12n + 1n }], T1),
    ).rejects.toThrow();

    expect(await marketPrices()).toEqual({});
    expect(await holdingPrice(connection.pool, holding)).toMatchObject({ unitPrice: null });
    expect(
      await sqlState(
        connection.pool,
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 0, now())",
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        connection.pool,
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 1000000000001, now())",
      ),
    ).toBe('23514');
  });

  it('propagates a database error and leaves neither statement applied', async () => {
    const broken = createDatabase(testDatabaseUrl);
    const brokenRepository = new DrizzleCryptoPriceRepository(broken.db);
    await broken.pool.end();

    await expect(
      brokenRepository.storeAndApply([{ symbol: 'btc', unitPrice: 1n }], T1),
    ).rejects.toThrow();
    await expect(brokenRepository.symbolsToPrice(10)).rejects.toThrow();
    expect(await marketPrices()).toEqual({});
  });
});

describe('storeAndApply racing a manual price (AC-06)', () => {
  /** Resolves once some backend is blocked on a lock, so the commit happens while it waits. */
  async function waitForLockWaiter(pool: pg.Pool): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await pool.query<{ n: string }>(
        "select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
      );
      if (Number(waiting.rows[0]?.n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the apply statement never waited on the row lock');
  }

  it('keeps a manual price committed while the apply statement waits on the row lock', async () => {
    const holding = await crypto('btc');
    const other = new pg.Client({ connectionString: testDatabaseUrl });
    await other.connect();
    try {
      await other.query('begin');
      await other.query('select id from holdings where id = $1 for update', [holding]);

      const apply = repository.storeAndApply([{ symbol: 'btc', unitPrice: 6_789_012n }], T1);
      await waitForLockWaiter(connection.pool);
      await other.query(
        `update holdings set unit_price = 6000000, price_source = 'manual', priced_at = $2, updated_at = now()
         where id = $1`,
        [holding, hoursBefore(T1, 1).toISOString()],
      );
      await other.query('commit');

      expect(await apply).toEqual({ markets: 1, holdings: 0 });
      expect(await holdingPrice(connection.pool, holding)).toMatchObject({
        unitPrice: 6_000_000n,
        source: 'manual',
        pricedAt: hoursBefore(T1, 1),
      });
      expect(await marketPrices()).toEqual({ btc: { unitPrice: 6_789_012n, pricedAt: T1 } });
    } finally {
      await other.end();
    }
  });
});

describe('DrizzleCryptoPriceRepository.symbolsToPrice', () => {
  it('returns distinct lowercase symbols of crypto holdings only, never priced first then the least recently priced', async () => {
    const second = await insertPortfolio(connection.pool, owner, { name: 'Binance' });
    await crypto('BTC');
    await insertHolding(connection.pool, {
      portfolioId: second,
      ownerId: owner,
      ticker: 'btc',
    });
    await crypto('eth');
    await crypto('sol');
    await crypto('ada');
    await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      ticker: 'aapl',
      type: 'cedear',
      currency: 'ARS',
    });
    await connection.pool.query(
      `insert into crypto_market_prices (symbol, unit_price, priced_at) values
         ('btc', 100, $1), ('eth', 100, $2), ('doge', 100, $3)`,
      [T2.toISOString(), T0.toISOString(), T0.toISOString()],
    );

    // ada and sol have no stored price (alphabetical among themselves); eth is older than btc.
    expect(await repository.symbolsToPrice(100)).toEqual(['ada', 'sol', 'eth', 'btc']);
  });

  it('includes manually priced symbols and orders by the market time, not by the holding price', async () => {
    await crypto('btc', { unitPrice: 6_000_000n, source: 'manual', pricedAt: T2 });
    await crypto('eth', { unitPrice: 200_000n, source: 'automatic', pricedAt: T0 });
    await connection.pool.query(
      `insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 100, $1), ('eth', 100, $2)`,
      [T0.toISOString(), T2.toISOString()],
    );

    expect(await repository.symbolsToPrice(100)).toEqual(['btc', 'eth']);
  });

  it('returns at most the limit and eventually covers every symbol across calls', async () => {
    const symbols = Array.from({ length: 105 }, (_, index) => `c${String(index).padStart(3, '0')}`);
    for (const symbol of symbols) await crypto(symbol);

    const first = await repository.symbolsToPrice(100);
    expect(first).toHaveLength(100);
    expect(first).toEqual(symbols.slice(0, 100));

    await repository.storeAndApply(
      first.map((symbol) => ({ symbol, unitPrice: 100n })),
      T1,
    );
    // The five never priced symbols come first; the priced ones follow.
    expect((await repository.symbolsToPrice(100)).slice(0, 5)).toEqual(symbols.slice(100));
  });

  it('returns an empty list when nobody holds crypto', async () => {
    expect(await repository.symbolsToPrice(100)).toEqual([]);
  });

  it('never returns a ticker the market table would reject, and still returns the others', async () => {
    await crypto('BTC/USD');
    await crypto('has space');
    await crypto('eth');

    expect(await repository.symbolsToPrice(100)).toEqual(['eth']);
  });
});

describe('storeAndApply lock order', () => {
  it('works with unsorted input', async () => {
    await crypto('btc');
    await crypto('ada');

    const result = await repository.storeAndApply(
      [
        { symbol: 'eth', unitPrice: 3n },
        { symbol: 'btc', unitPrice: 2n },
        { symbol: 'ada', unitPrice: 1n },
      ],
      T1,
    );

    expect(result).toEqual({ markets: 3, holdings: 2 });
    expect(Object.keys(await marketPrices())).toEqual(['ada', 'btc', 'eth']);
  });

  it('completes two concurrent calls with overlapping reversed symbol lists without a deadlock', async () => {
    const symbols = Array.from({ length: 40 }, (_, index) => `d${String(index).padStart(2, '0')}`);
    for (const symbol of symbols.slice(0, 5)) await crypto(symbol);
    const quotes = symbols.map((symbol) => ({ symbol, unitPrice: 100n }));
    const reversed = [...quotes].reverse();

    for (let round = 0; round < 5; round += 1) {
      await connection.pool.query('delete from crypto_market_prices');
      const results = await Promise.all([
        repository.storeAndApply(quotes, new Date(T1.getTime() + round * 1000)),
        repository.storeAndApply(reversed, new Date(T1.getTime() + round * 1000)),
      ]);
      expect(results).toHaveLength(2);
    }
  });
});
