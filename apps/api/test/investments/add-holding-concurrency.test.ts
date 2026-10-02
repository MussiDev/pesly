import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AddHolding } from '../../src/investments/application/holding-use-cases';
import type { InvestmentsRepositories } from '../../src/investments/application/ports';
import { DrizzleMarketPriceReader } from '../../src/investments/infrastructure/db/drizzle-market-price-reader';
import { DrizzleHoldingRepository } from '../../src/investments/infrastructure/db/drizzle-holding-repository';
import { DrizzleInvestmentsUnitOfWork } from '../../src/investments/infrastructure/db/drizzle-unit-of-work';
import { DrizzlePortfolioRepository } from '../../src/investments/infrastructure/db/drizzle-portfolio-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { MutableClock } from '../fakes/mutable-clock';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { scopeFor } from './fakes/in-memory-investments';

let connection: DatabaseConnection;
let unitOfWork: DrizzleInvestmentsUnitOfWork;
let marketPrices: DrizzleMarketPriceReader;
let ana: string;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  unitOfWork = new DrizzleInvestmentsUnitOfWork(connection.db);
  marketPrices = new DrizzleMarketPriceReader(connection.db);
});

beforeEach(async () => {
  ana = await seedUser(connection, { email: 'ana@race.test', password: 'a-long-password-1' });
});

afterAll(async () => {
  await connection.pool.end();
});

describe('AddHolding through the Drizzle unit of work', () => {
  it('merges two concurrent adds of the same ticker into one holding with the summed quantity (AC-23)', async () => {
    const write = await scopeFor(ana, 'write');
    const portfolio = await new DrizzlePortfolioRepository(connection.db).create(write, 'Balanz');
    const add = new AddHolding(
      unitOfWork,
      marketPrices,
      new MutableClock(new Date('2026-10-01T12:00:00.000Z')),
    );
    const input = (ticker: string, quantity: bigint, totalCost: bigint) => ({
      portfolioId: portfolio.id,
      ticker,
      instrumentName: 'Apple CEDEAR',
      instrumentType: 'cedear' as const,
      quantity,
      valuationCurrency: 'ARS' as const,
      totalCost,
    });

    const results = await Promise.all([
      add.execute(write, input('AAPL', 1_000_000_000n, 15_000_000n)),
      add.execute(write, input('aapl', 500_000_000n, 5_000_000n)),
    ]);

    expect(results.map((result) => result.merged).sort()).toEqual([false, true]);
    const stored = await new DrizzleHoldingRepository(connection.db).listByOwner(
      await scopeFor(ana, 'read'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ quantity: 1_500_000_000n, totalCost: 20_000_000n });
  });

  it('merges many concurrent adds without a unique violation', async () => {
    const write = await scopeFor(ana, 'write');
    const portfolio = await new DrizzlePortfolioRepository(connection.db).create(write, 'Balanz');
    const add = new AddHolding(unitOfWork, marketPrices, new MutableClock());

    await Promise.all(
      Array.from({ length: 6 }, () =>
        add.execute(write, {
          portfolioId: portfolio.id,
          ticker: 'AAPL',
          instrumentName: 'Apple CEDEAR',
          instrumentType: 'cedear',
          quantity: 100_000_000n,
          valuationCurrency: 'ARS',
        }),
      ),
    );

    const stored = await new DrizzleHoldingRepository(connection.db).listByPortfolio(
      await scopeFor(ana, 'read'),
      portfolio.id,
    );
    expect(stored.map((holding) => holding.quantity)).toEqual([600_000_000n]);
  });
});

describe('DrizzleInvestmentsUnitOfWork', () => {
  it('hands transaction-bound repositories to the work and commits its writes together', async () => {
    const write = await scopeFor(ana, 'write');

    const created = await unitOfWork.run(
      async ({ portfolios, holdings }: InvestmentsRepositories) => {
        const portfolio = await portfolios.create(write, 'Balanz');
        await holdings.insert(write, portfolio.id, {
          ticker: 'AAPL',
          instrumentName: 'Apple',
          instrumentType: 'cedear',
          quantity: 1n,
          valuationCurrency: 'ARS',
          totalCost: null,
        });
        return portfolio;
      },
    );

    const read = await scopeFor(ana, 'read');
    expect(await new DrizzlePortfolioRepository(connection.db).findById(read, created.id)).toEqual(
      created,
    );
    expect(await new DrizzleHoldingRepository(connection.db).listByOwner(read)).toHaveLength(1);
  });

  it('writes nothing when the work fails halfway (atomicity)', async () => {
    const write = await scopeFor(ana, 'write');
    const failure = new Error('boom after the writes');

    await expect(
      unitOfWork.run(async ({ portfolios, holdings }) => {
        const portfolio = await portfolios.create(write, 'Ghost');
        await holdings.insert(write, portfolio.id, {
          ticker: 'AAPL',
          instrumentName: 'Apple',
          instrumentType: 'cedear',
          quantity: 1n,
          valuationCurrency: 'ARS',
          totalCost: null,
        });
        throw failure;
      }),
    ).rejects.toBe(failure);

    const read = await scopeFor(ana, 'read');
    expect(await new DrizzlePortfolioRepository(connection.db).listForOwner(read)).toEqual([]);
    expect(await new DrizzleHoldingRepository(connection.db).listByOwner(read)).toEqual([]);
  });
});
