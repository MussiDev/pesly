import {
  MARKET_PRICE_RECENT_WITHIN_MS,
  gainOrLoss,
  holdingValue,
  isPriceStale,
  marketPriceDiffers,
  totalsByCurrency,
  type GainOrLoss,
  type ValuationCurrency,
} from '@pesly/shared';
import type { Holding } from '../domain/holding';
import type { MarketPrice, MarketPriceReader, Portfolio } from './ports';

/** Read model: bigint-valued, serialized to decimal strings only at the HTTP boundary. */
export interface HoldingView extends Holding {
  /** Null without a price ("price needed"). */
  value: bigint | null;
  /** Null without a value or without a total cost. */
  gain: GainOrLoss | null;
  priceStale: boolean;
  /** The stored market price of a crypto holding; null for any other holding or without one. */
  market: MarketPrice | null;
  /** A manual price more than 5% away from the market price, whatever the market price's age. */
  marketPriceDiffers: boolean;
  /** The market price is at most 24 hours old; false without one. */
  marketPriceRecent: boolean;
}

/** Stored market prices by lowercase symbol. */
export type MarketPrices = ReadonlyMap<string, MarketPrice>;

export interface CurrencyTotal {
  currency: ValuationCurrency;
  value: bigint;
}

export interface PortfolioView {
  id: string;
  name: string;
  createdAt: Date;
  totals: CurrencyTotal[];
  holdingsWithoutPrice: number;
  holdings: HoldingView[];
}

const CURRENCY_ORDER: readonly ValuationCurrency[] = ['ARS', 'USD'];

/** The lowercase symbols worth looking up: only crypto holdings have a market price. */
export function marketSymbolsOf(holdings: readonly Holding[]): string[] {
  const symbols = new Set<string>();
  for (const holding of holdings) {
    if (holding.instrumentType === 'crypto') symbols.add(holding.ticker.toLowerCase());
  }
  return [...symbols];
}

/** One reader call for all the crypto holdings given, none when there is no crypto holding. */
export async function lookupMarketPrices(
  reader: MarketPriceReader,
  holdings: readonly Holding[],
): Promise<MarketPrices> {
  const symbols = marketSymbolsOf(holdings);
  return symbols.length === 0 ? new Map() : reader.findMany(symbols);
}

export function buildHoldingView(
  holding: Holding,
  now: Date,
  marketPrices: MarketPrices,
): HoldingView {
  const value =
    holding.price === null ? null : holdingValue(holding.quantity, holding.price.unitPrice);
  const gain =
    value === null || holding.totalCost === null ? null : gainOrLoss(value, holding.totalCost);
  const priceStale = holding.price !== null && isPriceStale(holding.price.pricedAt, now);
  const market =
    holding.instrumentType === 'crypto'
      ? (marketPrices.get(holding.ticker.toLowerCase()) ?? null)
      : null;
  return {
    ...holding,
    value,
    gain,
    priceStale,
    market,
    marketPriceDiffers:
      market !== null &&
      holding.price !== null &&
      holding.price.source === 'manual' &&
      marketPriceDiffers(holding.price.unitPrice, market.unitPrice),
    marketPriceRecent:
      market !== null && now.getTime() - market.pricedAt.getTime() <= MARKET_PRICE_RECENT_WITHIN_MS,
  };
}

function compareTickers(a: Holding, b: Holding): number {
  const left = a.ticker.toLowerCase();
  const right = b.ticker.toLowerCase();
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Oldest first; equal creation times fall back to a plain id comparison so the order is stable. */
function comparePortfolios(a: Portfolio, b: Portfolio): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

export function buildPortfolioView(
  portfolio: Portfolio,
  holdings: readonly Holding[],
  now: Date,
  marketPrices: MarketPrices,
): PortfolioView {
  const views = [...holdings]
    .sort(compareTickers)
    .map((holding) => buildHoldingView(holding, now, marketPrices));
  const sums = totalsByCurrency(views);
  // A currency appears only when one of its holdings has a value, so a zero is never invented.
  const totals = CURRENCY_ORDER.filter((currency) =>
    views.some((view) => view.valuationCurrency === currency && view.value !== null),
  ).map((currency) => ({ currency, value: sums[currency] }));

  return {
    id: portfolio.id,
    name: portfolio.name,
    createdAt: portfolio.createdAt,
    totals,
    holdingsWithoutPrice: views.filter((view) => view.price === null).length,
    holdings: views,
  };
}

/** Groups the caller's holdings under their portfolios; portfolios come oldest first. */
export function buildPortfolioViews(
  portfolios: readonly Portfolio[],
  holdings: readonly Holding[],
  now: Date,
  marketPrices: MarketPrices,
): PortfolioView[] {
  const byPortfolio = new Map<string, Holding[]>();
  for (const holding of holdings) {
    const group = byPortfolio.get(holding.portfolioId);
    if (group === undefined) byPortfolio.set(holding.portfolioId, [holding]);
    else group.push(holding);
  }
  return [...portfolios]
    .sort(comparePortfolios)
    .map((portfolio) =>
      buildPortfolioView(portfolio, byPortfolio.get(portfolio.id) ?? [], now, marketPrices),
    );
}
