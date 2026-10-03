import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleMarketPriceReader } from '../../src/investments/infrastructure/db/drizzle-market-price-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let reader: DrizzleMarketPriceReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleMarketPriceReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const T0 = new Date('2026-10-02T10:00:00.000Z');
const T1 = new Date('2026-10-02T11:00:00.000Z');

async function seedPrices(): Promise<void> {
  await connection.pool.query(
    `insert into crypto_market_prices (symbol, unit_price, priced_at)
     values ('btc', 6789012, $1), ('eth', 250000, $2), ('sol', 15000, $2)`,
    [T0.toISOString(), T1.toISOString()],
  );
}

describe('DrizzleMarketPriceReader', () => {
  it('returns the stored prices of the asked symbols in one query, as bigint and Date', async () => {
    await seedPrices();
    const query = vi.spyOn(connection.pool, 'query');

    const prices = await reader.findMany(['btc', 'eth']);

    expect(query).toHaveBeenCalledTimes(1);
    query.mockRestore();
    expect(prices).toEqual(
      new Map([
        ['btc', { unitPrice: 6_789_012n, pricedAt: T0 }],
        ['eth', { unitPrice: 250_000n, pricedAt: T1 }],
      ]),
    );
  });

  it('returns nothing for unknown symbols and ignores stored symbols that were not asked', async () => {
    await seedPrices();

    expect(await reader.findMany(['doge'])).toEqual(new Map());
    expect([...(await reader.findMany(['sol', 'doge'])).keys()]).toEqual(['sol']);
  });

  it('binds the symbols as parameters, so a hostile text only matches nothing', async () => {
    await seedPrices();

    expect(await reader.findMany(["btc' or '1'='1"])).toEqual(new Map());
  });

  it('returns an empty map without querying for an empty list', async () => {
    const query = vi.spyOn(connection.pool, 'query');

    expect(await reader.findMany([])).toEqual(new Map());

    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });

  it('propagates a database error', async () => {
    const broken = createDatabase(testDatabaseUrl);
    const brokenReader = new DrizzleMarketPriceReader(broken.db);
    await broken.pool.end();

    await expect(brokenReader.findMany(['btc'])).rejects.toThrow();
  });
});
