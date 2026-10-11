export const INSTRUMENT_TYPES = [
  'stock',
  'cedear',
  'bond',
  'mutual_fund',
  'fixed_term_deposit',
  'crypto',
  'other',
] as const;

export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const VALUATION_CURRENCIES = ['ARS', 'USD'] as const;

export type ValuationCurrency = (typeof VALUATION_CURRENCIES)[number];

export const PRICE_SOURCES = ['import', 'manual', 'automatic'] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Quantities are integers scaled by 10^8. */
export const QUANTITY_SCALE = 100_000_000n;

/** A price is stale once more than 7 x 24 hours have passed since it was set. */
export const STALE_PRICE_AFTER_MS = 7 * 24 * 3_600_000;

export const PORTFOLIO_NAME_MAX_LENGTH = 60;
export const TICKER_MAX_LENGTH = 20;
export const INSTRUMENT_NAME_MAX_LENGTH = 100;

/** Upper bounds, in scaled units (quantity) or minor units (amounts). */
export const QUANTITY_MAX = 10n ** 18n;
export const TOTAL_COST_MAX = 10n ** 15n;
export const UNIT_PRICE_MAX = 10n ** 12n;

/** A market price is "recent" while it is at most 24 hours old; only the web wording depends on it. */
export const MARKET_PRICE_RECENT_WITHIN_MS = 24 * 3_600_000;

/** The most holdings one Balanz import can carry (DISC-001-07c NFR-01). */
export const IMPORT_MAX_HOLDINGS = 1000;
