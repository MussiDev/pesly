import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  type DashboardAction,
  type DashboardResponse,
  type DashboardUpcoming,
  type NetWorthResponse,
} from '@pesly/shared';
import type { Locale } from '@/i18n/routing';
import type { CategoryView, DashboardView, SeriesView, UpcomingView } from '../dashboard-view';

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

// The web has no statement route and no occurrence route: a statement links to its card and an
// occurrence to the recurring list; only a recurring payment has its own page.
function toUpcomingView(entry: DashboardUpcoming): UpcomingView {
  return {
    kind: entry.kind,
    href:
      entry.kind === 'card_statement' ? `/cards/${entry.cardId}` : `/recurring/${entry.paymentId}`,
    overdue: false,
    name: entry.name,
    date: entry.date,
    amount: BigInt(entry.amount),
    currency: entry.currency,
  };
}

/** The 09b actions carry no amount or currency, so those stay null in the view. */
function toActionView(entry: DashboardAction, today: string): UpcomingView {
  const isStatement = entry.kind === 'unpaid_statement';
  return {
    kind: entry.kind,
    href: isStatement ? `/cards/${entry.cardId}` : '/recurring',
    // ISO calendar dates compare as text.
    overdue: entry.kind === 'overdue_occurrence' || (isStatement && entry.dueDate < today),
    name: entry.name,
    date: entry.dueDate,
    amount: null,
    currency: null,
  };
}

function toCategoryViews(raw: DashboardResponse, options: AdapterOptions): CategoryView[] {
  return raw.categories.map((row, index) => {
    const color = DEFAULT_CATEGORIES.find((entry) => entry.key === row.defaultKey)?.color;
    return {
      key: `${index}:${row.categoryId ?? row.defaultKey ?? 'row'}`,
      label: resolveLabel(row.defaultKey, row.name, options),
      amount: BigInt(row.amount),
      share: row.sharePercent,
      ...(color === undefined ? {} : { color }),
      // The detail counts like the ring (card purchases by due month, group shares), which the
      // movement list cannot. Ids are validated UUIDs and the month is YYYY-MM: no escaping.
      ...(row.categoryId === null
        ? {}
        : {
            href: `/categories/spending?id=${row.categoryId}&month=${raw.month.from.slice(0, 7)}`,
          }),
    };
  });
}

export function toDashboardView(raw: DashboardResponse, options: AdapterOptions): DashboardView {
  const { netWorth, available, month, groups } = raw;
  return {
    currency: raw.currency,
    available: {
      total: available.total === null ? null : BigInt(available.total),
      reason: available.reason,
      ars: BigInt(available.ars),
      usd: BigInt(available.usd),
    },
    netWorth: {
      total: netWorth.total === null ? null : BigInt(netWorth.total),
      reason: netWorth.reason,
      ars: BigInt(netWorth.ars),
      usd: BigInt(netWorth.usd),
      holdingsWithoutPrice: netWorth.holdingsWithoutPrice,
    },
    month: {
      expenses: { value: BigInt(month.expenses), change: month.change.expenses },
      income: { value: BigInt(month.income), change: month.change.income },
      net: { value: BigInt(month.net), change: month.change.net },
      leftOutCount: month.unconvertedShareCount + month.unconvertedInstallmentCount,
      pendingCard: {
        value: BigInt(month.pendingCard.amount),
        nextDueDate: month.pendingCard.nextDueDate,
        leftOutCount: month.pendingCard.unconvertedCount,
      },
    },
    categories: toCategoryViews(raw, options),
    budgets: raw.budgets.map((budget) => ({
      id: budget.budgetId,
      name: budget.name,
      currency: budget.currency,
      percent: budget.percentUsed,
      status: budget.status,
      href: `/budgets/${budget.budgetId}`,
    })),
    upcoming: raw.upcoming.map(toUpcomingView),
    actions: raw.actions.map((action) => toActionView(action, raw.today)),
    groups: {
      owedToYou: { ARS: BigInt(groups.owedToYou.ars), USD: BigInt(groups.owedToYou.usd) },
      youOwe: { ARS: BigInt(groups.youOwe.ars), USD: BigInt(groups.youOwe.usd) },
    },
    insight:
      raw.insight === null
        ? null
        : {
            label: resolveLabel(raw.insight.defaultKey, raw.insight.name, options),
            share: raw.insight.sharePercent,
            change: raw.insight.changePercent,
          },
    firstSteps: raw.firstSteps,
  };
}

/** Points with a null total are kept: the points list shows their ARS and USD parts. */
export function toSeriesView(series: NetWorthResponse): SeriesView {
  return {
    currency: series.currency,
    points: series.points.map((point) => ({
      date: point.date,
      ars: BigInt(point.ars),
      usd: BigInt(point.usd),
      total: point.total === null ? null : BigInt(point.total),
      reason: point.reason,
    })),
  };
}
