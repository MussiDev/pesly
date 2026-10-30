import type {
  CategoryLanguage,
  CategoryResponse,
  CategorizedMovementType,
  MovementSummaryRow,
} from '@pesly/shared';
import { categoryLabel } from '@/features/categories/category-display';

/** Pesos first: the currency most movements are in leads every figure. */
const CURRENCY_ORDER = ['ARS', 'USD'] as const;

export interface SummaryMoney {
  currency: string;
  amount: bigint;
}

export interface SummaryCategory {
  /** The category to filter by when the row is chosen; `null` for movements without one. */
  id: string | null;
  label: string | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  /** One figure per currency, pesos first; never added across currencies. */
  amounts: SummaryMoney[];
  count: number;
  /** Share of the breakdown in the first currency, in basis points (0 to 10000). */
  basisPoints: number;
}

export interface MovementSummaryView {
  expense: SummaryMoney[];
  income: SummaryMoney[];
  /** Which type the category breakdown adds up. */
  breakdown: CategorizedMovementType;
  /** The currency the shares are measured in: pesos when there are any. */
  leadCurrency: string | undefined;
  /** What the breakdown adds up to in that currency. */
  breakdownTotal: bigint;
  categories: SummaryCategory[];
}

function byCurrency(a: SummaryMoney, b: SummaryMoney): number {
  const order = (currency: string) => {
    const index = CURRENCY_ORDER.indexOf(currency as (typeof CURRENCY_ORDER)[number]);
    return index === -1 ? CURRENCY_ORDER.length : index;
  };
  return order(a.currency) - order(b.currency) || (a.currency < b.currency ? -1 : 1);
}

function addTo(totals: SummaryMoney[], currency: string, amount: bigint): void {
  const existing = totals.find((entry) => entry.currency === currency);
  if (existing === undefined) totals.push({ currency, amount });
  else existing.amount += amount;
}

function amountIn(amounts: readonly SummaryMoney[], currency: string): bigint {
  return amounts.find((entry) => entry.currency === currency)?.amount ?? 0n;
}

/**
 * The totals of the filtered movements and where they went. Subcategories add up into their parent,
 * unless that parent is the chosen category: then each subcategory shows on its own.
 */
export function movementSummaryView(
  rows: readonly MovementSummaryRow[],
  categories: readonly CategoryResponse[],
  options: {
    language: CategoryLanguage;
    selectedCategoryId: string | undefined;
    breakdown: CategorizedMovementType;
  },
): MovementSummaryView {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const expense: SummaryMoney[] = [];
  const income: SummaryMoney[] = [];
  const groups = new Map<string | null, { amounts: SummaryMoney[]; count: number }>();

  for (const row of rows) {
    const amount = BigInt(row.amount);
    addTo(row.type === 'expense' ? expense : income, row.currency, amount);
    if (row.type !== options.breakdown) continue;
    const own = row.categoryId === null ? undefined : byId.get(row.categoryId);
    const parent = own === undefined || own.parentId === null ? undefined : byId.get(own.parentId);
    const keepOwn =
      parent === undefined ||
      parent.id === options.selectedCategoryId ||
      own?.id === options.selectedCategoryId;
    const key = own === undefined ? row.categoryId : keepOwn ? own.id : parent.id;
    const group = groups.get(key) ?? { amounts: [], count: 0 };
    addTo(group.amounts, row.currency, amount);
    group.count += row.count;
    groups.set(key, group);
  }

  const entries = [...groups].map(([id, group]) => ({ id, ...group }));
  entries.forEach((entry) => entry.amounts.sort(byCurrency));
  const lead = [...entries.flatMap((entry) => entry.amounts)].sort(byCurrency)[0]?.currency;
  entries.sort((a, b) => {
    for (const currency of CURRENCY_ORDER) {
      const difference = amountIn(b.amounts, currency) - amountIn(a.amounts, currency);
      if (difference !== 0n) return difference > 0n ? 1 : -1;
    }
    return b.count - a.count;
  });
  const breakdownTotal =
    lead === undefined
      ? 0n
      : entries.reduce((sum, entry) => sum + amountIn(entry.amounts, lead), 0n);

  return {
    expense: expense.sort(byCurrency),
    income: income.sort(byCurrency),
    breakdown: options.breakdown,
    leadCurrency: lead,
    breakdownTotal,
    categories: entries.map((entry) => {
      const category = entry.id === null ? undefined : byId.get(entry.id);
      const own = lead === undefined ? 0n : amountIn(entry.amounts, lead);
      return {
        id: entry.id,
        label: category === undefined ? undefined : categoryLabel(category, options.language),
        icon: category?.icon,
        color: category?.color,
        amounts: entry.amounts,
        count: entry.count,
        // An integer share for drawing; the money itself never leaves bigint.
        basisPoints: breakdownTotal > 0n ? Number((own * 10000n) / breakdownTotal) : 0,
      };
    }),
  };
}
