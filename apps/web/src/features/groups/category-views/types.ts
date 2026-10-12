import type { AccountCurrency } from '@pesly/shared';

/** How one category is shown: icon and color keys go to `CategoryVisual`, which tolerates unknown keys. */
export interface CategoryDisplay {
  id: string;
  /** The category's name; for an unknown category the caller's uncategorized text (never the id). */
  label: string;
  icon: string;
  color: string;
  archived: boolean;
  /** False when the id is not in the loaded categories: the neutral fallback (D7). */
  known: boolean;
}

export interface SummaryLine {
  /** Stable key: the category id, or `uncategorized` for the merged fallback line. */
  key: string;
  /** The ids a tap filters by: one, or every merged unknown id. */
  categoryIds: string[];
  display: CategoryDisplay;
  total: bigint;
  count: number;
  /** Integer basis points of the currency total, 0 to 10000 (D6). */
  shareBasisPoints: number;
}

export interface SummaryCurrencyView {
  currency: AccountCurrency;
  total: bigint;
  count: number;
  lines: SummaryLine[];
}

export interface SummaryView {
  currencies: SummaryCurrencyView[];
}

export interface FilteredTotal {
  currency: AccountCurrency;
  total: bigint;
  count: number;
}

export interface MonthOption {
  /** `YYYY-MM` */
  value: string;
}
