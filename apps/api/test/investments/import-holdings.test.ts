import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ImportHoldings,
  type ImportHoldingRow,
} from '../../src/investments/application/import-holdings';
import { AddHolding } from '../../src/investments/application/holding-use-cases';
import { InvestmentRuleViolation } from '../../src/investments/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import { MutableClock } from '../fakes/mutable-clock';
import {
  InMemoryInvestments,
  InMemoryMarketPriceReader,
  scopeFor,
} from './fakes/in-memory-investments';

const ALICE = randomUUID();
const BOB = randomUUID();
const START = new Date('2026-10-10T12:00:00.000Z');
const FILE_DAY = new Date('2026-10-09T00:00:00.000Z');

async function setup() {
  const clock = new MutableClock(START);
  const store = new InMemoryInvestments(clock);
  const market = new InMemoryMarketPriceReader();
  const portfolio = await store.portfolios.create(await scopeFor(ALICE, 'write'), 'Balanz');
  return {
    store,
    portfolio,
    importHoldings: new ImportHoldings(store, market, clock),
    add: new AddHolding(store, market, clock),
  };
}

function row(ticker: string, overrides: Partial<ImportHoldingRow> = {}): ImportHoldingRow {
  return {
    ticker,
    instrumentName: `${ticker} CEDEAR`,
    instrumentType: 'cedear',
    valuationCurrency: 'ARS',
    quantity: 4_600_000_000n,
    totalCost: 41_949_600n,
    unitPrice: 753_500n,
    pricedAt: FILE_DAY,
    ...overrides,
  };
}

function held(portfolioId: string, ticker: string, overrides = {}) {
  return {
    portfolioId,
    ticker,
    instrumentName: ticker,
    instrumentType: 'cedear' as const,
    quantity: 100_000_000n,
    valuationCurrency: 'ARS' as const,
    ...overrides,
  };
}

describe('ImportHoldings', () => {
  it('leaves exactly the holdings of the file, priced "import" with the file cost (AC-03)', async () => {
    const { importHoldings, add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(
      scope,
      held(portfolio.id, 'ibit', { instrumentName: 'old name', totalCost: 1_000n }),
    );
    await add.execute(scope, held(portfolio.id, 'AAPL'));

    const result = await importHoldings.execute(scope, portfolio.id, [row('IBIT'), row('SPY')]);

    expect({ created: result.created, updated: result.updated, removed: result.removed }).toEqual({
      created: 1,
      updated: 1,
      removed: 1,
    });
    const stored = await store.holdings.listByPortfolio(scope, portfolio.id);
    expect(stored.map((holding) => holding.ticker).sort()).toEqual(['SPY', 'ibit']);
    for (const holding of stored) {
      expect(holding.quantity).toBe(4_600_000_000n);
      expect(holding.totalCost).toBe(41_949_600n);
      expect(holding.price).toEqual({ unitPrice: 753_500n, source: 'import', pricedAt: FILE_DAY });
    }
    expect(stored.find((holding) => holding.ticker === 'ibit')?.instrumentName).toBe('old name');
    expect(result.portfolio.holdings).toHaveLength(2);
  });

  it('applies the currency chosen in the preview, also on an existing holding (AC-09)', async () => {
    const { importHoldings, add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(scope, held(portfolio.id, 'SPY', { totalCost: 5_000n }));

    await importHoldings.execute(scope, portfolio.id, [
      row('SPY', { valuationCurrency: 'USD' }),
      row('IBIT'),
    ]);

    const stored = await store.holdings.listByPortfolio(scope, portfolio.id);
    expect(stored.find((holding) => holding.ticker === 'SPY')?.valuationCurrency).toBe('USD');
    expect(stored.find((holding) => holding.ticker === 'IBIT')?.valuationCurrency).toBe('ARS');
  });

  it('keeps the cost empty when the file has none', async () => {
    const { importHoldings, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');

    await importHoldings.execute(scope, portfolio.id, [row('IBIT', { totalCost: null })]);

    const [stored] = await store.holdings.listByPortfolio(scope, portfolio.id);
    expect(stored?.totalCost).toBeNull();
  });

  it('rolls everything back when a write fails midway (AC-05)', async () => {
    const { importHoldings, add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(scope, held(portfolio.id, 'AAPL', { totalCost: 7n }));
    const before = structuredClone(await store.holdings.listByPortfolio(scope, portfolio.id));
    const holdings = store.holdings;
    const realInsert = holdings.insert.bind(holdings);
    let inserts = 0;
    store.holdings.insert = (...args) => {
      inserts += 1;
      return inserts === 2 ? Promise.reject(new Error('boom')) : realInsert(...args);
    };

    await expect(
      importHoldings.execute(scope, portfolio.id, [row('IBIT'), row('SPY'), row('QQQ')]),
    ).rejects.toThrow('boom');

    expect(await store.holdings.listByPortfolio(scope, portfolio.id)).toEqual(before);
  });

  it('answers not found for a portfolio of another user and writes nothing (AC-05)', async () => {
    const { importHoldings, portfolio, store } = await setup();
    const bob = await scopeFor(BOB, 'write');

    await expect(importHoldings.execute(bob, portfolio.id, [row('IBIT')])).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(importHoldings.execute(bob, randomUUID(), [row('IBIT')])).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(store.holdingRows.size).toBe(0);
  });

  it('rejects a repeated ticker and a crypto ticker as a validation failure on holdings (AC-05)', async () => {
    const { importHoldings, add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(
      scope,
      held(portfolio.id, 'BTC', { instrumentType: 'crypto', valuationCurrency: 'USD' }),
    );

    await expect(
      importHoldings.execute(scope, portfolio.id, [row('IBIT'), row('ibit')]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: ['body.holdings'] });
    await expect(importHoldings.execute(scope, portfolio.id, [row('BTC')])).rejects.toBeInstanceOf(
      InvestmentRuleViolation,
    );
    expect(store.holdingRows.size).toBe(1);
  });

  it('takes the portfolio lock before reading, so a concurrent import cannot interleave', async () => {
    const { importHoldings, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');

    await importHoldings.execute(scope, portfolio.id, [row('IBIT')]);

    expect(store.calls.slice(0, 2)).toEqual(['portfolios.lockById', 'holdings.listByPortfolio']);
  });
});
