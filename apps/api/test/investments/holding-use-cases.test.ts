import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AddHolding,
  DeleteHolding,
  GetHolding,
  SetManualPrice,
  UpdateHolding,
  UseAutomaticPrice,
  type AddHoldingInput,
} from '../../src/investments/application/holding-use-cases';
import { GetPortfolio } from '../../src/investments/application/portfolio-use-cases';
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
const START = new Date('2026-10-01T12:00:00.000Z');

async function setup() {
  const clock = new MutableClock(START);
  const store = new InMemoryInvestments(clock);
  const market = new InMemoryMarketPriceReader();
  const portfolio = await store.portfolios.create(await scopeFor(ALICE, 'write'), 'Balanz');
  return {
    clock,
    store,
    market,
    portfolio,
    add: new AddHolding(store, market, clock),
    get: new GetHolding(store.holdings, market, clock),
    update: new UpdateHolding(store, market, clock),
    setPrice: new SetManualPrice(store.holdings, market, clock),
    useAutomatic: new UseAutomaticPrice(store.holdings, market, clock),
    remove: new DeleteHolding(store.holdings),
    getPortfolio: new GetPortfolio(store.portfolios, store.holdings, market, clock),
  };
}

function input(portfolioId: string, overrides: Partial<AddHoldingInput> = {}): AddHoldingInput {
  return {
    portfolioId,
    ticker: 'AAPL',
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: 15_000_000n,
    ...overrides,
  };
}

describe('AddHolding', () => {
  it('stores "AAPL", CEDEAR, 10 units, ARS, cost 150,000.00 without a price (AC-02)', async () => {
    const { add, portfolio, store } = await setup();

    const result = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    expect(result.merged).toBe(false);
    expect(result.holding).toMatchObject({
      ticker: 'AAPL',
      instrumentType: 'cedear',
      quantity: 1_000_000_000n,
      valuationCurrency: 'ARS',
      totalCost: 15_000_000n,
      price: null,
      value: null,
      gain: null,
      priceStale: false,
    });
    expect(store.holdingRows.size).toBe(1);
  });

  // The fake only records call order; that the lock really serializes concurrent adds is proven
  // by the Block 4 concurrency test against PostgreSQL.
  it('locks the portfolio before looking up the ticker', async () => {
    const { add, portfolio, store } = await setup();

    await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    const lock = store.calls.indexOf('portfolios.lockById');
    const lookup = store.calls.indexOf('holdings.findByTicker');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lookup).toBeGreaterThan(lock);
  });

  it('stores a holding without total cost when none is given', async () => {
    const { add, portfolio } = await setup();

    const { holding } = await add.execute(
      await scopeFor(ALICE, 'write'),
      input(portfolio.id, { totalCost: undefined }),
    );

    expect(holding.totalCost).toBeNull();
  });

  it('merges "aapl" into an existing "AAPL" and reports merged (AC-23)', async () => {
    const { add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const first = await add.execute(scope, input(portfolio.id));

    const second = await add.execute(
      scope,
      input(portfolio.id, { ticker: 'aapl', quantity: 500_000_000n, totalCost: 5_000_000n }),
    );

    expect(second.merged).toBe(true);
    expect(second.holding).toMatchObject({
      id: first.holding.id,
      ticker: 'AAPL',
      quantity: 1_500_000_000n,
      totalCost: 20_000_000n,
    });
    expect(store.holdingRows.size).toBe(1);
  });

  it('raises the domain violation on another currency and leaves the holding unchanged (AC-24)', async () => {
    const { add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(scope, input(portfolio.id));

    const attempt = add.execute(scope, input(portfolio.id, { valuationCurrency: 'USD' }));

    await expect(attempt).rejects.toBeInstanceOf(InvestmentRuleViolation);
    await expect(attempt).rejects.toMatchObject({ fields: ['body.valuationCurrency'] });
    const [row] = [...store.holdingRows.values()];
    expect(row?.holding).toMatchObject({ quantity: 1_000_000_000n, valuationCurrency: 'ARS' });
  });

  it('rejects crypto in ARS and stores nothing (AC-18)', async () => {
    const { add, portfolio, store } = await setup();

    const attempt = add.execute(
      await scopeFor(ALICE, 'write'),
      input(portfolio.id, { ticker: 'BTC', instrumentType: 'crypto' }),
    );

    await expect(attempt).rejects.toMatchObject({ fields: ['body.valuationCurrency'] });
    expect(store.holdingRows.size).toBe(0);
  });

  it('answers not found for a portfolio of another user or a missing one (AC-15)', async () => {
    const { add, portfolio, store } = await setup();

    await expect(
      add.execute(await scopeFor(BOB, 'write'), input(portfolio.id)),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      add.execute(await scopeFor(ALICE, 'write'), input(randomUUID())),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.size).toBe(0);
  });
});

describe('GetHolding', () => {
  it('reads a holding of the caller and hides a foreign one (AC-15)', async () => {
    const { add, get, portfolio } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    const view = await get.execute(await scopeFor(ALICE, 'read'), holding.id);

    expect(view.id).toBe(holding.id);
    await expect(get.execute(await scopeFor(BOB, 'read'), holding.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('UpdateHolding', () => {
  it('keeps the price and cost when only the quantity changes (AC-05)', async () => {
    const { add, update, setPrice, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    await setPrice.execute(scope, holding.id, 1_850_000n);

    const view = await update.execute(scope, holding.id, { quantity: 1_500_000_000n });

    expect(view).toMatchObject({
      quantity: 1_500_000_000n,
      totalCost: 15_000_000n,
      price: { unitPrice: 1_850_000n, source: 'manual', pricedAt: START },
      value: 27_750_000n,
    });
  });

  // Call order only; real row locking is proven by the Block 4 concurrency test.
  it('reads the holding with a locking read, not a plain one', async () => {
    const { add, update, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    store.calls.length = 0;

    await update.execute(scope, holding.id, { quantity: 1n });

    expect(store.calls).toContain('holdings.findForUpdate');
    expect(store.calls).not.toContain('holdings.findById');
  });

  it('clears the stored price on a currency change so it reads "price needed" (AC-22)', async () => {
    const { add, update, setPrice, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    await setPrice.execute(scope, holding.id, 1_850_000n);

    const view = await update.execute(scope, holding.id, {
      valuationCurrency: 'USD',
      totalCost: 100_000n,
    });

    expect(view).toMatchObject({
      valuationCurrency: 'USD',
      totalCost: 100_000n,
      price: null,
      value: null,
      gain: null,
    });
  });

  it('raises the violation when a currency change states no cost and changes nothing', async () => {
    const { add, update, store, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));

    await expect(
      update.execute(scope, holding.id, { valuationCurrency: 'USD' }),
    ).rejects.toMatchObject({ fields: ['body.totalCost'] });

    expect(store.holdingRows.get(holding.id)?.holding.valuationCurrency).toBe('ARS');
  });

  it('answers not found when updating a holding of another user (AC-15)', async () => {
    const { add, update, store, portfolio } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(
      update.execute(await scopeFor(BOB, 'write'), holding.id, { quantity: 1n }),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect(store.holdingRows.get(holding.id)?.holding.quantity).toBe(1_000_000_000n);
  });

  it('answers not found for a missing holding', async () => {
    const { update } = await setup();

    await expect(
      update.execute(await scopeFor(ALICE, 'write'), randomUUID(), { quantity: 1n }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('SetManualPrice', () => {
  it('stores 18,500.00 with source manual and the clock time (AC-07, AC-09)', async () => {
    const { add, setPrice, clock, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    clock.advance(60_000);

    const view = await setPrice.execute(scope, holding.id, 1_850_000n);

    expect(view.price).toEqual({
      unitPrice: 1_850_000n,
      source: 'manual',
      pricedAt: new Date(START.getTime() + 60_000),
    });
    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toEqual({ amount: 3_500_000n, basisPoints: 2333n });
  });

  it('answers not found for a holding of another user or a missing one (AC-15)', async () => {
    const { add, setPrice, portfolio, store } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(
      setPrice.execute(await scopeFor(BOB, 'write'), holding.id, 1n),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      setPrice.execute(await scopeFor(ALICE, 'write'), randomUUID(), 1n),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.get(holding.id)?.holding.price).toBeNull();
  });
});

const BTC = { ticker: 'BTC', instrumentType: 'crypto', valuationCurrency: 'USD' } as const;
const MARKET_TIME = new Date('2026-10-01T10:00:00.000Z');

/** A manual BTC holding at 60,000.00 USD with a stored market price of 64,000.00 USD (+6.67%). */
async function manualCrypto(ctx: Awaited<ReturnType<typeof setup>>) {
  const scope = await scopeFor(ALICE, 'write');
  const { holding } = await ctx.add.execute(scope, input(ctx.portfolio.id, { ...BTC }));
  await ctx.setPrice.execute(scope, holding.id, 6_000_000n);
  ctx.market.set('btc', 6_400_000n, MARKET_TIME);
  ctx.market.calls.length = 0;
  return { scope, id: holding.id };
}

describe('UseAutomaticPrice', () => {
  it('sets the market price, source automatic and the market time, and the warning disappears (AC-12)', async () => {
    const ctx = await setup();
    const { scope, id } = await manualCrypto(ctx);
    const before = await ctx.get.execute(await scopeFor(ALICE, 'read'), id);
    expect(before.marketPriceDiffers).toBe(true);
    ctx.market.calls.length = 0;
    ctx.clock.advance(60_000);

    const view = await ctx.useAutomatic.execute(scope, id);

    expect(view.price).toEqual({
      unitPrice: 6_400_000n,
      source: 'automatic',
      pricedAt: MARKET_TIME,
    });
    expect(view.value).toBe(64_000_000n);
    expect(view.marketPriceDiffers).toBe(false);
    expect(view.market).toEqual({ unitPrice: 6_400_000n, pricedAt: MARKET_TIME });
    expect(ctx.store.holdingRows.get(id)?.holding.price).toEqual(view.price);
    expect(ctx.market.calls).toHaveLength(1);
  });

  it('rejects a stock holding on the marketPrice field and changes nothing (AC-13)', async () => {
    const ctx = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await ctx.add.execute(scope, input(ctx.portfolio.id, { ticker: 'BTC' }));
    await ctx.setPrice.execute(scope, holding.id, 1_850_000n);
    ctx.market.set('btc', 6_400_000n, MARKET_TIME);
    const stored = ctx.store.holdingRows.get(holding.id)?.holding;

    const attempt = ctx.useAutomatic.execute(scope, holding.id);

    await expect(attempt).rejects.toBeInstanceOf(InvestmentRuleViolation);
    await expect(attempt).rejects.toMatchObject({ fields: ['body.marketPrice'] });
    expect(ctx.store.holdingRows.get(holding.id)?.holding).toEqual(stored);
  });

  it.each([
    ['ticker', { ticker: 'ETH' }],
    ['instrument type', { instrumentType: 'stock' as const }],
  ])(
    'writes nothing and rejects on marketPrice when the %s changes between the read and the write',
    async (_name, change) => {
      const ctx = await setup();
      const { scope, id } = await manualCrypto(ctx);
      const original = ctx.market.findMany.bind(ctx.market);
      ctx.market.findMany = async (symbols) => {
        const found = await original(symbols);
        const row = ctx.store.holdingRows.get(id);
        if (row) row.holding = { ...row.holding, ...change };
        return found;
      };
      const before = ctx.store.holdingRows.get(id)?.holding.price;

      const attempt = ctx.useAutomatic.execute(scope, id);

      await expect(attempt).rejects.toBeInstanceOf(InvestmentRuleViolation);
      await expect(attempt).rejects.toMatchObject({ fields: ['body.marketPrice'] });
      expect(ctx.store.holdingRows.get(id)?.holding.price).toEqual(before);
    },
  );

  it('rejects a crypto holding without a stored market price and changes nothing (AC-13)', async () => {
    const ctx = await setup();
    const { scope, id } = await manualCrypto(ctx);
    ctx.market.prices.clear();
    const stored = ctx.store.holdingRows.get(id)?.holding;

    const attempt = ctx.useAutomatic.execute(scope, id);

    await expect(attempt).rejects.toBeInstanceOf(InvestmentRuleViolation);
    await expect(attempt).rejects.toMatchObject({ fields: ['body.marketPrice'] });
    expect(ctx.store.holdingRows.get(id)?.holding).toEqual(stored);
  });

  it('answers not found for another owner or an unknown id and changes nothing (AC-14)', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    const stored = ctx.store.holdingRows.get(id)?.holding;

    await expect(ctx.useAutomatic.execute(await scopeFor(BOB, 'write'), id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      ctx.useAutomatic.execute(await scopeFor(ALICE, 'write'), randomUUID()),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(ctx.store.holdingRows.get(id)?.holding).toEqual(stored);
  });

  it('does not look up the market for a holding it cannot switch', async () => {
    const ctx = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await ctx.add.execute(scope, input(ctx.portfolio.id));
    ctx.market.calls.length = 0;

    await expect(ctx.useAutomatic.execute(scope, holding.id)).rejects.toBeInstanceOf(
      InvestmentRuleViolation,
    );
    await expect(ctx.useAutomatic.execute(scope, randomUUID())).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(ctx.market.calls).toEqual([]);
  });

  it('propagates a storage failure of the reader and changes nothing', async () => {
    const ctx = await setup();
    const { scope, id } = await manualCrypto(ctx);
    ctx.market.failure = new Error('reader down');
    const stored = ctx.store.holdingRows.get(id)?.holding;

    await expect(ctx.useAutomatic.execute(scope, id)).rejects.toThrow('reader down');
    expect(ctx.store.holdingRows.get(id)?.holding).toEqual(stored);
  });
});

describe('market price in the holding use cases (FR-05)', () => {
  it('fills the market fields on get, edit and manual price, one reader call each, lowercase ticker', async () => {
    const ctx = await setup();
    const { scope, id } = await manualCrypto(ctx);

    const got = await ctx.get.execute(await scopeFor(ALICE, 'read'), id);
    const edited = await ctx.update.execute(scope, id, { quantity: 200_000_000n });
    const priced = await ctx.setPrice.execute(scope, id, 6_000_000n);

    for (const view of [got, edited, priced]) {
      expect(view.market).toEqual({ unitPrice: 6_400_000n, pricedAt: MARKET_TIME });
      expect(view.marketPriceDiffers).toBe(true);
      expect(view.marketPriceRecent).toBe(true);
    }
    expect(ctx.market.calls).toEqual([['btc'], ['btc'], ['btc']]);
  });

  it('fills the market fields on add, including a merge, with one reader call each', async () => {
    const ctx = await setup();
    ctx.market.set('btc', 6_400_000n, MARKET_TIME);
    const scope = await scopeFor(ALICE, 'write');

    const created = await ctx.add.execute(scope, input(ctx.portfolio.id, { ...BTC }));
    const merged = await ctx.add.execute(
      scope,
      input(ctx.portfolio.id, { ...BTC, ticker: 'btc', totalCost: undefined }),
    );

    expect(created.holding.market).toEqual({ unitPrice: 6_400_000n, pricedAt: MARKET_TIME });
    expect(merged.merged).toBe(true);
    expect(merged.holding.market).toEqual({ unitPrice: 6_400_000n, pricedAt: MARKET_TIME });
    expect(ctx.market.calls).toEqual([['btc'], ['btc']]);
  });

  it('makes no reader call when the holding is not crypto', async () => {
    const ctx = await setup();
    const scope = await scopeFor(ALICE, 'write');

    const { holding } = await ctx.add.execute(scope, input(ctx.portfolio.id));
    await ctx.get.execute(await scopeFor(ALICE, 'read'), holding.id);
    await ctx.update.execute(scope, holding.id, { quantity: 1n });
    const priced = await ctx.setPrice.execute(scope, holding.id, 1_850_000n);

    expect(ctx.market.calls).toEqual([]);
    expect(priced).toMatchObject({
      market: null,
      marketPriceDiffers: false,
      marketPriceRecent: false,
    });
  });

  it('answers not found before reading the market for a foreign holding', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);

    await expect(ctx.get.execute(await scopeFor(BOB, 'read'), id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(ctx.setPrice.execute(await scopeFor(BOB, 'write'), id, 1n)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(ctx.market.calls).toEqual([]);
  });

  it('propagates a storage failure of the reader from get', async () => {
    const ctx = await setup();
    const { id } = await manualCrypto(ctx);
    ctx.market.failure = new Error('reader down');

    await expect(ctx.get.execute(await scopeFor(ALICE, 'read'), id)).rejects.toThrow('reader down');
  });
});

describe('DeleteHolding', () => {
  it('removes the holding and the portfolio total is recomputed (AC-06)', async () => {
    const { add, setPrice, remove, getPortfolio, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const aapl = await add.execute(scope, input(portfolio.id));
    const meli = await add.execute(scope, input(portfolio.id, { ticker: 'MELI' }));
    await setPrice.execute(scope, aapl.holding.id, 1_850_000n);
    await setPrice.execute(scope, meli.holding.id, 1_000_000n);
    const before = await getPortfolio.execute(await scopeFor(ALICE, 'read'), portfolio.id);
    expect(before.totals).toEqual([{ currency: 'ARS', value: 28_500_000n }]);

    await remove.execute(scope, aapl.holding.id);

    const after = await getPortfolio.execute(await scopeFor(ALICE, 'read'), portfolio.id);
    expect(after.holdings.map((h) => h.ticker)).toEqual(['MELI']);
    expect(after.totals).toEqual([{ currency: 'ARS', value: 10_000_000n }]);
  });

  it('answers not found for a foreign or missing holding (AC-15)', async () => {
    const { add, remove, portfolio, store } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(remove.execute(await scopeFor(BOB, 'write'), holding.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      remove.execute(await scopeFor(ALICE, 'write'), randomUUID()),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.size).toBe(1);
  });
});
