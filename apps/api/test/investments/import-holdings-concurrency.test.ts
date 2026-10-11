import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ImportHoldings,
  type ImportHoldingRow,
} from '../../src/investments/application/import-holdings';
import { DrizzleHoldingRepository } from '../../src/investments/infrastructure/db/drizzle-holding-repository';
import { DrizzleInvestmentsUnitOfWork } from '../../src/investments/infrastructure/db/drizzle-unit-of-work';
import { DrizzleMarketPriceReader } from '../../src/investments/infrastructure/db/drizzle-market-price-reader';
import { DrizzlePortfolioRepository } from '../../src/investments/infrastructure/db/drizzle-portfolio-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { MutableClock } from '../fakes/mutable-clock';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { scopeFor } from './fakes/in-memory-investments';

let connection: DatabaseConnection;
let importHoldings: ImportHoldings;
let ana: string;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  importHoldings = new ImportHoldings(
    new DrizzleInvestmentsUnitOfWork(connection.db),
    new DrizzleMarketPriceReader(connection.db),
    new MutableClock(new Date('2026-10-10T12:00:00.000Z')),
  );
});

beforeEach(async () => {
  ana = await seedUser(connection, { email: 'ana@import.test', password: 'a-long-password-1' });
});

afterAll(async () => {
  await connection.pool.end();
});

function row(ticker: string, overrides: Partial<ImportHoldingRow> = {}): ImportHoldingRow {
  return {
    ticker,
    instrumentName: `${ticker} CEDEAR`,
    instrumentType: 'cedear',
    valuationCurrency: 'ARS',
    quantity: 100_000_000n,
    totalCost: 1_000n,
    unitPrice: 5_000n,
    pricedAt: new Date('2026-10-09T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ImportHoldings through the Drizzle unit of work', () => {
  it('runs two imports of one portfolio one after the other, the second seeing the first (AC-03)', async () => {
    const write = await scopeFor(ana, 'write');
    const portfolio = await new DrizzlePortfolioRepository(connection.db).create(write, 'Balanz');

    const results = await Promise.all([
      importHoldings.execute(write, portfolio.id, [row('IBIT'), row('SPY')]),
      importHoldings.execute(write, portfolio.id, [row('ibit'), row('QQQ')]),
    ]);

    const stored = await new DrizzleHoldingRepository(connection.db).listByPortfolio(
      await scopeFor(ana, 'read'),
      portfolio.id,
    );
    // Whichever ran second left exactly its own file: no duplicate ticker, no leftover of the first.
    expect(stored).toHaveLength(2);
    const tickers = stored.map((holding) => holding.ticker.toLowerCase()).sort();
    expect([
      ['ibit', 'qqq'],
      ['ibit', 'spy'],
    ]).toContainEqual(tickers);
    expect(results.map((result) => result.portfolio.holdings.length)).toEqual([2, 2]);
    expect(stored.every((holding) => holding.price?.source === 'import')).toBe(true);
  });
});
