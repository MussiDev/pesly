import type { HoldingResponse, PortfolioResponse } from '@pesly/shared';
import type { HoldingView, PortfolioView } from '../../application/portfolio-view';

/** The only place the bigint read model becomes decimal strings: JSON never carries a float. */
export function serializeHolding(view: HoldingView): HoldingResponse {
  return {
    id: view.id,
    portfolioId: view.portfolioId,
    ticker: view.ticker,
    instrumentName: view.instrumentName,
    instrumentType: view.instrumentType,
    quantity: view.quantity.toString(),
    valuationCurrency: view.valuationCurrency,
    totalCost: view.totalCost === null ? null : view.totalCost.toString(),
    unitPrice: view.price === null ? null : view.price.unitPrice.toString(),
    priceSource: view.price === null ? null : view.price.source,
    pricedAt: view.price === null ? null : view.price.pricedAt.toISOString(),
    priceStale: view.priceStale,
    marketUnitPrice: view.market === null ? null : view.market.unitPrice.toString(),
    marketPricedAt: view.market === null ? null : view.market.pricedAt.toISOString(),
    marketPriceDiffers: view.marketPriceDiffers,
    marketPriceRecent: view.marketPriceRecent,
    value: view.value === null ? null : view.value.toString(),
    gain:
      view.gain === null
        ? null
        : { amount: view.gain.amount.toString(), basisPoints: view.gain.basisPoints.toString() },
  };
}

export function serializePortfolio(view: PortfolioView): PortfolioResponse {
  return {
    id: view.id,
    name: view.name,
    createdAt: view.createdAt.toISOString(),
    totals: view.totals.map((total) => ({
      currency: total.currency,
      value: total.value.toString(),
    })),
    holdingsWithoutPrice: view.holdingsWithoutPrice,
    holdings: view.holdings.map(serializeHolding),
  };
}
