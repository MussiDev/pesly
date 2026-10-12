export type Currency = 'ARS' | 'USD';

export type BudgetStatus = 'on_track' | 'close' | 'over';

/** Every amount is a `bigint` in minor units. */
export interface NetWorthView {
  total: bigint | null;
  reason: 'no_rate' | null;
  ars: bigint;
  usd: bigint;
  holdingsWithoutPrice: number;
}

export interface ChangedAmount {
  value: bigint;
  /** Whole percent against the same period of the previous month; null when there is none. */
  change: number | null;
}

export interface MonthView {
  expenses: ChangedAmount;
  income: ChangedAmount;
  net: ChangedAmount;
  /** Shares and installments left out of the figures for lack of a frozen rate. */
  leftOutCount: number;
}

export interface CategoryView {
  /** Unique per row. */
  key: string;
  /** Already resolved in the active language; never empty. */
  label: string;
  amount: bigint;
  share: number;
}

export interface BudgetView {
  id: string;
  name: string;
  currency: Currency;
  percent: number;
  status: BudgetStatus;
  href: string;
}

/** An upcoming entry or a server action; `href` is built by the adapter, never from free text. */
export interface UpcomingView {
  kind: string;
  href: string;
  overdue: boolean;
  name: string | null;
  date: string | null;
  amount: bigint | null;
  currency: Currency | null;
}

export type ActionView = UpcomingView;

export interface GroupsView {
  owedToYou: Record<Currency, bigint>;
  youOwe: Record<Currency, bigint>;
}

export interface InsightView {
  label: string;
  share: number;
  change: number | null;
}

export interface FirstStepsView {
  hasAccount: boolean;
  hasMovement: boolean;
  show: boolean;
}

export interface SeriesPointView {
  date: string;
  ars: bigint;
  usd: bigint;
  total: bigint | null;
  reason: 'no_rate' | null;
}

/** The series with the currency its totals were converted to, which may differ from the dashboard's. */
export interface SeriesView {
  currency: Currency;
  points: SeriesPointView[];
}

export interface DashboardView {
  currency: Currency;
  netWorth: NetWorthView;
  month: MonthView;
  categories: CategoryView[];
  budgets: BudgetView[];
  upcoming: UpcomingView[];
  actions: ActionView[];
  groups: GroupsView;
  insight: InsightView | null;
  firstSteps: FirstStepsView;
}
