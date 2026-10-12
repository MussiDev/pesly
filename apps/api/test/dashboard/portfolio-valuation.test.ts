import { describe, expect, it, vi } from 'vitest';
import { PortfolioValuation } from '../../src/dashboard/infrastructure/investments/portfolio-valuation';
import { ListPortfolios } from '../../src/investments';
import { MutableClock } from '../fakes/mutable-clock';
import {
  InMemoryInvestments,
  InMemoryMarketPriceReader,
  scopeFor,
} from '../investments/fakes/in-memory-investments';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-10-06T16:00:00.000Z');

async function setup() {
  const clock = new MutableClock(NOW);
  const store = new InMemoryInvestments(clock);
  const market = new InMemoryMarketPriceReader();
  const valuation = new PortfolioValuation(
    new ListPortfolios(store.portfolios, store.holdings, market, clock),
  );
  const write = await scopeFor(OWNER, 'write');
  const portfolio = await store.portfolios.create(write, 'Balanz');
  return { store, valuation, write, portfolio };
}

describe('portfolio valuation', () => {
  it('(AC-12) values a crypto holding from its stored price and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { store, valuation, write, portfolio } = await setup();
    const holding = await store.holdings.insert(write, portfolio.id, {
      ticker: 'BTC',
      instrumentName: 'Bitcoin',
      instrumentType: 'crypto',
      quantity: 50_000_000n,
      valuationCurrency: 'USD',
      totalCost: null,
    });
    await store.holdings.setPrice(write, holding?.id ?? '', 6_000_000n, 'automatic', NOW);

    const value = await valuation.valueNow(await scopeFor(OWNER, 'read'));

    expect(value).toEqual({ ARS: 0n, USD: 3_000_000n, holdingsWithoutPrice: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('(AC-13) a holding with no price counts 0 and is counted as without price', async () => {
    const { store, valuation, write, portfolio } = await setup();
    await store.holdings.insert(write, portfolio.id, {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: 100_000_000n,
      valuationCurrency: 'ARS',
      totalCost: null,
    });

    const value = await valuation.valueNow(await scopeFor(OWNER, 'read'));

    expect(value).toEqual({ ARS: 0n, USD: 0n, holdingsWithoutPrice: 1 });
  });

  it('sums every portfolio per currency and ignores other users', async () => {
    const { store, valuation, write, portfolio } = await setup();
    const second = await store.portfolios.create(write, 'IBKR');
    const add = async (
      scope: typeof write,
      portfolioId: string,
      currency: 'ARS' | 'USD',
      price: bigint,
    ) => {
      const created = await store.holdings.insert(scope, portfolioId, {
        ticker: `T${price}`,
        instrumentName: 'x',
        instrumentType: 'cedear',
        quantity: 100_000_000n,
        valuationCurrency: currency,
        totalCost: null,
      });
      await store.holdings.setPrice(scope, created?.id ?? '', price, 'manual', NOW);
    };
    await add(write, portfolio.id, 'ARS', 1000n);
    await add(write, second.id, 'ARS', 2500n);
    await add(write, second.id, 'USD', 700n);
    const otherWrite = await scopeFor(OTHER, 'write');
    const foreign = await store.portfolios.create(otherWrite, 'x');
    await add(otherWrite, foreign.id, 'ARS', 999999n);

    const value = await valuation.valueNow(await scopeFor(OWNER, 'read'));

    expect(value).toEqual({ ARS: 3500n, USD: 700n, holdingsWithoutPrice: 0 });
  });
});
