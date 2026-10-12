import { DEFAULT_CATEGORIES, defaultCategoryName, type NetWorthResponse } from '@pesly/shared';
import type { Locale } from '@/i18n/routing';
import type { DashboardEntry, DashboardResponse } from '@/lib/dashboard-contract';
import type { CategoryView, DashboardView, SeriesPointView, UpcomingView } from '../dashboard-view';

// The only reader of raw 09b fields (spec D1). Every amount string was already proven to be an
// integer string by the parser, so `BigInt(text)` cannot throw here.

export interface AdapterOptions {
  locale: Locale;
  /** The catalog's generic category label, used when a row has neither a known key nor a name. */
  otherLabel: string;
}

function resolveLabel(
  defaultKey: string | null,
  name: string | null,
  { locale, otherLabel }: AdapterOptions,
): string {
  if (defaultKey !== null && DEFAULT_CATEGORIES.some((entry) => entry.key === defaultKey)) {
    return defaultCategoryName(defaultKey, locale);
  }
  const trimmed = name?.trim();
  return trimmed ? trimmed : otherLabel;
}

function entryHref(entry: DashboardEntry): string {
  const toCards = entry.kind.includes('statement') || entry.kind.includes('card');
  const prefix = toCards ? '/cards' : '/recurring';
  return entry.id === null ? prefix : `${prefix}/${entry.id}`;
}

function toEntryView(entry: DashboardEntry): UpcomingView {
  return {
    kind: entry.kind,
    href: entryHref(entry),
    overdue: entry.kind.includes('overdue'),
    name: entry.name,
    date: entry.date,
    amount: entry.amount === null ? null : BigInt(entry.amount),
    currency: entry.currency,
  };
}

function toCategoryViews(raw: DashboardResponse, options: AdapterOptions): CategoryView[] {
  return raw.categories.map((row, index) => ({
    key: `${index}:${row.categoryId ?? row.defaultKey ?? 'row'}`,
    label: resolveLabel(row.defaultKey, row.name, options),
    amount: BigInt(row.amount),
    share: row.share,
  }));
}

export function toDashboardView(raw: DashboardResponse, options: AdapterOptions): DashboardView {
  const { netWorth, month, groups } = raw;
  return {
    currency: raw.currency,
    netWorth: {
      total: netWorth.total === null ? null : BigInt(netWorth.total),
      reason: netWorth.reason,
      ars: BigInt(netWorth.ars),
      usd: BigInt(netWorth.usd),
      holdingsWithoutPrice: netWorth.holdingsWithoutPrice,
    },
    month: {
      expenses: { value: BigInt(month.expenses), change: month.expensesChange },
      income: { value: BigInt(month.income), change: month.incomeChange },
      net: { value: BigInt(month.net), change: month.netChange },
      leftOutCount: month.leftOutShares + month.leftOutInstallments,
    },
    categories: toCategoryViews(raw, options),
    budgets: raw.budgets.map((budget) => ({
      id: budget.id,
      name: budget.name,
      currency: budget.currency,
      percent: budget.percent,
      status: budget.status,
      href: `/budgets/${budget.id}`,
    })),
    upcoming: raw.upcoming.map(toEntryView),
    actions: raw.actions.map(toEntryView),
    groups: {
      owedToYou: { ARS: BigInt(groups.owedToYou.ARS), USD: BigInt(groups.owedToYou.USD) },
      youOwe: { ARS: BigInt(groups.youOwe.ARS), USD: BigInt(groups.youOwe.USD) },
    },
    insight:
      raw.insight === null
        ? null
        : {
            label: resolveLabel(raw.insight.defaultKey, raw.insight.name, options),
            share: raw.insight.share,
            change: raw.insight.change,
          },
    firstSteps: raw.firstSteps,
  };
}

/** Points with a null total are kept: the points list shows their ARS and USD parts. */
export function toSeriesView(series: NetWorthResponse): SeriesPointView[] {
  return series.points.map((point) => ({
    date: point.date,
    ars: BigInt(point.ars),
    usd: BigInt(point.usd),
    total: point.total === null ? null : BigInt(point.total),
    reason: point.reason,
  }));
}
