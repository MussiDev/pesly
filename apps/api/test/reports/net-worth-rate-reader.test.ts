import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleNetWorthRateReader } from '../../src/reports/infrastructure/db/drizzle-net-worth-rate-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query(
    `delete from exchange_rate_history where rate_type in ('mep', 'blue')`,
  );
  await connection.pool.query(`delete from exchange_rates where rate_type = 'mep'`);
  const rows = [
    ['mep', '2026-06-28', 11_000_000],
    ['mep', '2026-07-02', 13_000_000],
    ['blue', '2026-06-30', 90_000_000],
  ] as const;
  for (const [type, date, sell] of rows) {
    await connection.pool.query(
      `insert into exchange_rate_history (rate_type, rate_date, buy, sell, recorded_at)
       values ($1, $2, $3, $3, now())`,
      [type, date, sell],
    );
  }
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 17000000, 17500000, now(), now())`,
  );
});

describe('DrizzleNetWorthRateReader', () => {
  it('(AC-37) uses the latest history row on or before each past date and never a later one', async () => {
    const reader = new DrizzleNetWorthRateReader(connection.db);
    const rates = await reader.sellRates('mep', ['2026-06-30', '2026-07-31'], '2026-10-06');
    expect(rates.get('2026-06-30')).toBe(11_000_000n);
    expect(rates.get('2026-07-31')).toBe(13_000_000n);
  });

  it('returns null for a date before the first history row', async () => {
    const reader = new DrizzleNetWorthRateReader(connection.db);
    const rates = await reader.sellRates('mep', ['2026-06-27'], '2026-10-06');
    expect(rates.has('2026-06-27')).toBe(true);
    expect(rates.get('2026-06-27')).toBeNull();
  });

  it('reads the current point from the stored rate', async () => {
    const reader = new DrizzleNetWorthRateReader(connection.db);
    const rates = await reader.sellRates('mep', ['2026-06-30', '2026-10-06'], '2026-10-06');
    expect(rates.get('2026-10-06')).toBe(17_500_000n);
    expect(rates.get('2026-06-30')).toBe(11_000_000n);
  });

  it('only reads the requested rate type', async () => {
    const reader = new DrizzleNetWorthRateReader(connection.db);
    const rates = await reader.sellRates('blue', ['2026-06-30'], '2026-10-06');
    expect(rates.get('2026-06-30')).toBe(90_000_000n);
  });

  it('returns an empty map for no dates', async () => {
    const reader = new DrizzleNetWorthRateReader(connection.db);
    expect((await reader.sellRates('mep', [], '2026-10-06')).size).toBe(0);
  });
});
