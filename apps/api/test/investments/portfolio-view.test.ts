import { MARKET_PRICE_RECENT_WITHIN_MS, STALE_PRICE_AFTER_MS } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  buildHoldingView,
  buildPortfolioView,
  buildPortfolioViews,
} from '../../src/investments/application/portfolio-view';
import type { MarketPrice, Portfolio } from '../../src/investments/application/ports';
import type { Holding } from '../../src/investments/domain/holding';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const NO_MARKET: ReadonlyMap<string, MarketPrice> = new Map();
const PORTFOLIO: Portfolio = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Balanz',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    portfolioId: PORTFOLIO.id,
    ticker: 'AAPL',
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: 15_000_000n,
    price: { unitPrice: 1_850_000n, source: 'manual', pricedAt: NOW },
    ...overrides,
  };
}

describe('buildHoldingView', () => {
  it('gives a holding with no price a null value and a null gain, not stale (AC-19)', () => {
    const view = buildHoldingView(holding({ price: null }), NOW, NO_MARKET);

    expect(view.value).toBeNull();
    expect(view.gain).toBeNull();
    expect(view.priceStale).toBe(false);
  });

  it('values a priced holding and computes its gain (AC-12 control)', () => {
    const view = buildHoldingView(holding(), NOW, NO_MARKET);

    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toEqual({ amount: 3_500_000n, basisPoints: 2333n });
    expect(view.priceStale).toBe(false);
  });

  it('gives a holding without total cost a value but no gain (AC-12)', () => {
    const view = buildHoldingView(holding({ totalCost: null }), NOW, NO_MARKET);

    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toBeNull();
  });

  it('flags a price older than 7 days as stale and keeps its date (AC-14)', () => {
    const pricedAt = new Date(NOW.getTime() - STALE_PRICE_AFTER_MS - 1);
    const view = buildHoldingView(
      holding({ price: { unitPrice: 1_850_000n, source: 'import', pricedAt } }),
      NOW,
      NO_MARKET,
    );

    expect(view.priceStale).toBe(true);
    expect(view.price?.pricedAt).toEqual(pricedAt);
  });

  it('does not flag a price at exactly 7 days (AC-14 boundary)', () => {
    const pricedAt = new Date(NOW.getTime() - STALE_PRICE_AFTER_MS);
    const view = buildHoldingView(
      holding({ price: { unitPrice: 1_850_000n, source: 'import', pricedAt } }),
      NOW,
      NO_MARKET,
    );

    expect(view.priceStale).toBe(false);
  });
});

describe('market price in the holding view (FR-05)', () => {
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;

  function crypto(overrides: Partial<Holding> = {}): Holding {
    return holding({
      ticker: 'BTC',
      instrumentName: 'Bitcoin',
      instrumentType: 'crypto',
      valuationCurrency: 'USD',
      quantity: 100_000_000n,
      totalCost: null,
      price: { unitPrice: 6_000_000n, source: 'manual', pricedAt: NOW },
      ...overrides,
    });
  }

  function marketAt(unitPrice: bigint, ageMs: number): ReadonlyMap<string, MarketPrice> {
    return new Map([['btc', { unitPrice, pricedAt: new Date(NOW.getTime() - ageMs) }]]);
  }

  it('warns for a manual price 6.67% below a market price from 3 hours ago, with its date (AC-07, AC-08)', () => {
    const view = buildHoldingView(crypto(), NOW, marketAt(6_400_000n, 3 * HOUR_MS));

    expect(view.market).toEqual({
      unitPrice: 6_400_000n,
      pricedAt: new Date(NOW.getTime() - 3 * HOUR_MS),
    });
    expect(view.marketPriceDiffers).toBe(true);
    expect(view.marketPriceRecent).toBe(true);
  });

  it('warns when the market price is 6.67% below the manual one', () => {
    const view = buildHoldingView(crypto(), NOW, marketAt(5_600_000n, HOUR_MS));

    expect(view.marketPriceDiffers).toBe(true);
  });

  it('does not warn at exactly 5% above or below, but still carries the market price (AC-09)', () => {
    const above = buildHoldingView(crypto(), NOW, marketAt(6_300_000n, HOUR_MS));
    const below = buildHoldingView(crypto(), NOW, marketAt(5_700_000n, HOUR_MS));

    expect(above.marketPriceDiffers).toBe(false);
    expect(below.marketPriceDiffers).toBe(false);
    expect(above.market?.unitPrice).toBe(6_300_000n);
  });

  it.each(['automatic', 'import'] as const)(
    'does not warn for a %s price even when the market price is far away (AC-10)',
    (source) => {
      const view = buildHoldingView(
        crypto({ price: { unitPrice: 6_000_000n, source, pricedAt: NOW } }),
        NOW,
        marketAt(9_000_000n, HOUR_MS),
      );

      expect(view.marketPriceDiffers).toBe(false);
      expect(view.market?.unitPrice).toBe(9_000_000n);
    },
  );

  it('does not warn for a crypto holding without a price', () => {
    const view = buildHoldingView(crypto({ price: null }), NOW, marketAt(9_000_000n, HOUR_MS));

    expect(view.marketPriceDiffers).toBe(false);
    expect(view.market?.unitPrice).toBe(9_000_000n);
  });

  it('is recent at exactly 24 hours and not recent 24 hours and one second ago, still warning (AC-11)', () => {
    expect(MARKET_PRICE_RECENT_WITHIN_MS).toBe(DAY_MS);

    const atLimit = buildHoldingView(crypto(), NOW, marketAt(6_400_000n, DAY_MS));
    const past = buildHoldingView(crypto(), NOW, marketAt(6_400_000n, DAY_MS + 1_000));

    expect(atLimit.marketPriceRecent).toBe(true);
    expect(atLimit.marketPriceDiffers).toBe(true);
    expect(past.marketPriceRecent).toBe(false);
    expect(past.marketPriceDiffers).toBe(true);
  });

  it.each([
    ['2 days', 2 * DAY_MS],
    ['30 days', 30 * DAY_MS],
  ])('an old market price (%s) is not recent and still warns (AC-11, AC-16)', (_label, age) => {
    const view = buildHoldingView(crypto(), NOW, marketAt(6_400_000n, age));

    expect(view.marketPriceRecent).toBe(false);
    expect(view.marketPriceDiffers).toBe(true);
    expect(view.market?.pricedAt).toEqual(new Date(NOW.getTime() - age));
  });

  it('has no market fields without a stored market price', () => {
    const view = buildHoldingView(crypto(), NOW, NO_MARKET);

    expect(view.market).toBeNull();
    expect(view.marketPriceDiffers).toBe(false);
    expect(view.marketPriceRecent).toBe(false);
  });

  it('matches the market price by lowercase ticker', () => {
    const view = buildHoldingView(crypto({ ticker: 'bTc' }), NOW, marketAt(6_400_000n, HOUR_MS));

    expect(view.market?.unitPrice).toBe(6_400_000n);
  });

  it('gives a holding that is not crypto no market price, even when a symbol matches', () => {
    const view = buildHoldingView(holding({ ticker: 'BTC' }), NOW, marketAt(9_000_000n, HOUR_MS));

    expect(view.market).toBeNull();
    expect(view.marketPriceDiffers).toBe(false);
    expect(view.marketPriceRecent).toBe(false);
  });

  it('fills the market fields on every holding of a portfolio view and of the grouped views', () => {
    const btc = crypto({ id: 'a' });
    const eth = crypto({ id: 'b', ticker: 'ETH' });
    const market = marketAt(6_400_000n, HOUR_MS);

    const one = buildPortfolioView(PORTFOLIO, [btc, eth], NOW, market);
    const many = buildPortfolioViews([PORTFOLIO], [btc, eth], NOW, market);

    expect(one.holdings.map((h) => [h.ticker, h.marketPriceDiffers])).toEqual([
      ['BTC', true],
      ['ETH', false],
    ]);
    expect(many[0]?.holdings.map((h) => h.market?.unitPrice ?? null)).toEqual([6_400_000n, null]);
  });
});

describe('buildPortfolioView', () => {
  it('totals only priced holdings: 185,000.00 ARS plus an unpriced one (AC-20)', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [holding(), holding({ id: 'b', ticker: 'MELI', price: null })],
      NOW,
      NO_MARKET,
    );

    expect(view.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view.holdingsWithoutPrice).toBe(1);
  });

  it('lists ARS before USD and omits a currency with no valued holding', () => {
    const usd = holding({
      id: 'c',
      ticker: 'BTC',
      instrumentType: 'crypto',
      valuationCurrency: 'USD',
      quantity: 100_000_000n,
      price: { unitPrice: 50_000n, source: 'manual', pricedAt: NOW },
    });
    const both = buildPortfolioView(PORTFOLIO, [usd, holding()], NOW, NO_MARKET);
    const onlyUsd = buildPortfolioView(PORTFOLIO, [usd], NOW, NO_MARKET);
    const none = buildPortfolioView(PORTFOLIO, [holding({ price: null })], NOW, NO_MARKET);

    expect(both.totals).toEqual([
      { currency: 'ARS', value: 18_500_000n },
      { currency: 'USD', value: 50_000n },
    ]);
    expect(onlyUsd.totals).toEqual([{ currency: 'USD', value: 50_000n }]);
    expect(none.totals).toEqual([]);
  });

  it('counts holdings without a price (AC-21)', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [holding({ id: 'a', price: null }), holding({ id: 'b', ticker: 'MELI', price: null })],
      NOW,
      NO_MARKET,
    );

    expect(view.holdingsWithoutPrice).toBe(2);
  });

  it('orders holdings by ticker ignoring case', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [
        holding({ id: 'a', ticker: 'CEDE' }),
        holding({ id: 'b', ticker: 'Bbar' }),
        holding({ id: 'c', ticker: 'aapl' }),
      ],
      NOW,
      NO_MARKET,
    );

    // A case-sensitive sort would give ['Bbar', 'CEDE', 'aapl'].
    expect(view.holdings.map((h) => h.ticker)).toEqual(['aapl', 'Bbar', 'CEDE']);
  });

  it('has empty holdings and no totals for an empty portfolio', () => {
    const view = buildPortfolioView(PORTFOLIO, [], NOW, NO_MARKET);

    expect(view).toMatchObject({
      id: PORTFOLIO.id,
      name: 'Balanz',
      createdAt: PORTFOLIO.createdAt,
      totals: [],
      holdingsWithoutPrice: 0,
      holdings: [],
    });
  });
});

describe('buildPortfolioViews', () => {
  it('groups holdings by portfolio and orders portfolios by creation time', () => {
    const older: Portfolio = { id: 'older', name: 'Old', createdAt: new Date('2026-01-01') };
    const newer: Portfolio = { id: 'newer', name: 'New', createdAt: new Date('2026-06-01') };

    const views = buildPortfolioViews(
      [newer, older],
      [holding({ id: 'a', portfolioId: 'older' }), holding({ id: 'b', portfolioId: 'newer' })],
      NOW,
      NO_MARKET,
    );

    expect(views.map((v) => v.id)).toEqual(['older', 'newer']);
    expect(views[0]?.holdings.map((h) => h.id)).toEqual(['a']);
    expect(views[1]?.holdings.map((h) => h.id)).toEqual(['b']);
  });

  it('breaks a creation-time tie by id, whatever the input order', () => {
    const createdAt = new Date('2026-03-01T00:00:00.000Z');
    const a: Portfolio = { id: 'a-id', name: 'A', createdAt };
    const b: Portfolio = { id: 'b-id', name: 'B', createdAt };
    const c: Portfolio = { id: 'c-id', name: 'C', createdAt };

    expect(buildPortfolioViews([c, a, b], [], NOW, NO_MARKET).map((v) => v.id)).toEqual([
      'a-id',
      'b-id',
      'c-id',
    ]);
    expect(buildPortfolioViews([b, c, a], [], NOW, NO_MARKET).map((v) => v.id)).toEqual([
      'a-id',
      'b-id',
      'c-id',
    ]);
  });
});
