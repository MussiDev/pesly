export type ReportKind = 'categories' | 'incomeExpenses' | 'netWorth';

export type ReportCurrency = 'ARS' | 'USD';

/** One row of the spending list; `percent` is a whole number, `underOne` marks a positive row below 1%. */
export interface CategoryRowView {
  key: string;
  label: string;
  amount: bigint;
  percent: number;
  underOne: boolean;
  /** The catalog colour of a default category; others take the ring's own colours. */
  color?: string | undefined;
}

export interface CategoriesView {
  currency: ReportCurrency;
  from: string;
  to: string;
  total: bigint;
  rows: CategoryRowView[];
  unconvertedShareCount: number;
  unconvertedInstallmentCount: number;
}

export interface MonthView {
  /** `YYYY-MM`. */
  month: string;
  income: bigint;
  expenses: bigint;
  /** Income minus expenses. */
  net: bigint;
}

export interface IncomeExpensesView {
  currency: ReportCurrency;
  from: string;
  to: string;
  months: MonthView[];
  unconvertedShareCount: number;
  unconvertedInstallmentCount: number;
}

/** `ars` and `usd` are in their own currencies; `total` is in the display currency, null with a reason. */
export interface NetWorthPointView {
  date: string;
  ars: bigint;
  usd: bigint;
  total: bigint | null;
  reason: 'no_rate' | null;
  incomplete: boolean;
}

export interface NetWorthView {
  currency: ReportCurrency;
  from: string;
  to: string;
  points: NetWorthPointView[];
}
