import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreatePortfolio,
  DeletePortfolio,
  GetPortfolio,
  ListPortfolios,
} from '../../src/investments/application/portfolio-use-cases';
import { ResourceNotFound } from '../../src/shared/access';
import { MutableClock } from '../fakes/mutable-clock';
import {
  InMemoryInvestments,
  InMemoryMarketPriceReader,
  scopeFor,
} from './fakes/in-memory-investments';

const ALICE = randomUUID();
const BOB = randomUUID();

function setup() {
  const clock = new MutableClock(new Date('2026-10-01T12:00:00.000Z'));
  const store = new InMemoryInvestments(clock);
  const market = new InMemoryMarketPriceReader();
  return {
    clock,
    store,
    market,
    create: new CreatePortfolio(store.portfolios, market, clock),
    list: new ListPortfolios(store.portfolios, store.holdings, market, clock),
    get: new GetPortfolio(store.portfolios, store.holdings, market, clock),
    remove: new DeletePortfolio(store.portfolios),
  };
}

async function addHolding(
  store: InMemoryInvestments,
  userId: string,
  portfolioId: string,
  ticker = 'AAPL',
  instrumentType: 'cedear' | 'crypto' = 'cedear',
) {
  const inserted = await store.holdings.insert(await scopeFor(userId, 'write'), portfolioId, {
    ticker,
    instrumentName: 'Apple CEDEAR',
    instrumentType,
    quantity: 1_000_000_000n,
    valuationCurrency: instrumentType === 'crypto' ? 'USD' : 'ARS',
    totalCost: null,
  });
  if (inserted === null) throw new Error('fixture insert failed');
  return inserted;
}

describe('portfolio use cases', () => {
  it('creates a portfolio named "Balanz" that appears in the list (AC-01)', async () => {
    const { create, list } = setup();

    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const listed = await list.execute(await scopeFor(ALICE, 'read'));

    expect(created).toMatchObject({ name: 'Balanz', holdings: [], totals: [] });
    expect(listed.map((p) => p.id)).toEqual([created.id]);
  });

  it('lists only the caller portfolios (AC-16)', async () => {
    const { create, list } = setup();
    await create.execute(await scopeFor(ALICE, 'write'), 'Alice');
    await create.execute(await scopeFor(BOB, 'write'), 'Bob');

    const listed = await list.execute(await scopeFor(BOB, 'read'));

    expect(listed.map((p) => p.name)).toEqual(['Bob']);
  });

  it('lists portfolios with their holdings and values', async () => {
    const { create, list, store, clock } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const holding = await addHolding(store, ALICE, created.id);
    await store.holdings.setPrice(
      await scopeFor(ALICE, 'write'),
      holding.id,
      1_850_000n,
      'manual',
      clock.now(),
    );

    const [view] = await list.execute(await scopeFor(ALICE, 'read'));

    expect(view?.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view?.holdings).toHaveLength(1);
  });

  describe('market price lookup (FR-05)', () => {
    const MARKET_TIME = new Date('2026-10-01T10:00:00.000Z');

    async function cryptoSetup() {
      const ctx = setup();
      const write = await scopeFor(ALICE, 'write');
      const first = await ctx.create.execute(write, 'First');
      const second = await ctx.create.execute(write, 'Second');
      const btc = await addHolding(ctx.store, ALICE, first.id, 'BTC', 'crypto');
      await addHolding(ctx.store, ALICE, first.id, 'eth', 'crypto');
      await addHolding(ctx.store, ALICE, first.id, 'AAPL');
      await addHolding(ctx.store, ALICE, second.id, 'BTC', 'crypto');
      await ctx.store.holdings.setPrice(write, btc.id, 6_000_000n, 'manual', ctx.clock.now());
      ctx.market.set('btc', 6_400_000n, MARKET_TIME);
      ctx.market.calls.length = 0;
      return { ...ctx, first, second };
    }

    it('lists portfolios with crypto holdings with one lookup, fills the fields per holding', async () => {
      const { list, market } = await cryptoSetup();

      const views = await list.execute(await scopeFor(ALICE, 'read'));

      expect(market.calls).toHaveLength(1);
      expect([...(market.calls[0] ?? [])].sort()).toEqual(['btc', 'eth']);
      const holdings = views.flatMap((view) => view.holdings);
      const byKey = Object.fromEntries(
        views.flatMap((view) =>
          view.holdings.map((h) => [
            view.name + h.ticker,
            [h.market?.unitPrice ?? null, h.marketPriceDiffers, h.marketPriceRecent],
          ]),
        ),
      );
      expect(holdings).toHaveLength(4);
      expect(byKey).toEqual({
        FirstAAPL: [null, false, false],
        FirstBTC: [6_400_000n, true, true],
        Firsteth: [null, false, false],
        SecondBTC: [6_400_000n, false, true],
      });
    });

    it('reads one portfolio with one lookup', async () => {
      const { get, market, first } = await cryptoSetup();

      const view = await get.execute(await scopeFor(ALICE, 'read'), first.id);

      expect(market.calls).toHaveLength(1);
      expect(view.holdings.find((h) => h.ticker === 'BTC')?.marketPriceDiffers).toBe(true);
    });

    it('makes no lookup for a list or a read without crypto, nor for an empty list', async () => {
      const { create, list, get, store, market } = setup();
      await list.execute(await scopeFor(ALICE, 'read'));
      const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
      await addHolding(store, ALICE, created.id);

      const listed = await list.execute(await scopeFor(ALICE, 'read'));
      const read = await get.execute(await scopeFor(ALICE, 'read'), created.id);

      expect(market.calls).toEqual([]);
      expect(listed[0]?.holdings[0]).toMatchObject({ market: null, marketPriceDiffers: false });
      expect(read.holdings[0]?.marketPriceRecent).toBe(false);
    });

    it('does not look up the market of another user or a missing portfolio', async () => {
      const { get, market, first } = await cryptoSetup();

      await expect(get.execute(await scopeFor(BOB, 'read'), first.id)).rejects.toBeInstanceOf(
        ResourceNotFound,
      );

      expect(market.calls).toEqual([]);
    });

    it('creates a portfolio without a lookup and propagates a reader failure on list', async () => {
      const { create, list, market } = await cryptoSetup();

      await create.execute(await scopeFor(ALICE, 'write'), 'Third');
      expect(market.calls).toEqual([]);

      market.failure = new Error('reader down');
      await expect(list.execute(await scopeFor(ALICE, 'read'))).rejects.toThrow('reader down');
    });
  });

  it('reads a portfolio of the caller', async () => {
    const { create, get } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');

    const view = await get.execute(await scopeFor(ALICE, 'read'), created.id);

    expect(view.id).toBe(created.id);
  });

  it('returns only the requested portfolio holdings, totals and unpriced count', async () => {
    const { create, get, store, clock } = setup();
    const write = await scopeFor(ALICE, 'write');
    const first = await create.execute(write, 'First');
    const second = await create.execute(write, 'Second');
    const priced = await addHolding(store, ALICE, first.id, 'AAPL');
    await addHolding(store, ALICE, first.id, 'MELI');
    const otherPriced = await addHolding(store, ALICE, second.id, 'BTC');
    await addHolding(store, ALICE, second.id, 'ETH');
    await addHolding(store, ALICE, second.id, 'SOL');
    await store.holdings.setPrice(write, priced.id, 1_850_000n, 'manual', clock.now());
    await store.holdings.setPrice(write, otherPriced.id, 5_000_000n, 'manual', clock.now());

    const view = await get.execute(await scopeFor(ALICE, 'read'), first.id);

    expect(view.holdings.map((h) => h.ticker)).toEqual(['AAPL', 'MELI']);
    expect(view.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view.holdingsWithoutPrice).toBe(1);
    expect(store.calls).toContain('holdings.listByPortfolio');
  });

  it('answers not found when reading a portfolio outside the scope or missing (AC-15)', async () => {
    const { create, get } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');

    await expect(get.execute(await scopeFor(BOB, 'read'), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(get.execute(await scopeFor(ALICE, 'read'), randomUUID())).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('answers not found when deleting a foreign portfolio and changes nothing (AC-15)', async () => {
    const { create, remove, store } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    await addHolding(store, ALICE, created.id);

    await expect(remove.execute(await scopeFor(BOB, 'write'), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(store.portfolioRows.size).toBe(1);
    expect(store.holdingRows.size).toBe(1);
  });

  it('answers not found when deleting a missing portfolio (AC-15)', async () => {
    const { remove } = setup();

    await expect(
      remove.execute(await scopeFor(ALICE, 'write'), randomUUID()),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('deletes a portfolio together with its holdings (AC-17)', async () => {
    const { create, remove, store } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const other = await create.execute(await scopeFor(ALICE, 'write'), 'Other');
    await addHolding(store, ALICE, created.id);
    await addHolding(store, ALICE, other.id);

    await remove.execute(await scopeFor(ALICE, 'write'), created.id);

    expect([...store.portfolioRows.keys()]).toEqual([other.id]);
    expect([...store.holdingRows.values()].map((r) => r.holding.portfolioId)).toEqual([other.id]);
  });
});
