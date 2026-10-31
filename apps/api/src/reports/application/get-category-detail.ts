import {
  addMonths,
  localDayBounds,
  todayInTimeZone,
  type CategoryDetailItem,
  type CategoryDetailQuery,
  type CategoryDetailResponse,
} from '@pesly/shared';
import { ResourceNotFound, type AccessScope } from '../../shared/access';
import type { FlowCurrency } from '../domain/conversion';
import {
  convertRows,
  installmentDueDate,
  installmentMonthOf,
  matchShareCategory,
  type ConvertibleRow,
} from '../domain/flows';
import type { CategoryItemReader } from './ports/category-item-reader';
import type { Clock } from './ports/clock';
import type { FlowReader } from './ports/flow-reader';
import type { ReportPreferencesReader } from './ports/report-preferences';

export interface GetCategoryDetailDependencies {
  clock: Clock;
  preferences: ReportPreferencesReader;
  flows: Pick<FlowReader, 'topCategories'>;
  items: CategoryItemReader;
}

/** A statement is due at most this many months after its period, and not before it. */
const PERIOD_MARGIN = 2;

function lastDayOf(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5, 7), 10);
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

/**
 * The total in the display currency, converted per group of the same keys the dashboard groups by
 * (`DrizzleFlowReader`), so rounding gives the dashboard's figure to the minor unit.
 */
function groupedTotal<Row extends ConvertibleRow>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
  display: FlowCurrency,
  onMissingRate: 'throw' | 'count',
): { total: bigint; unconvertedCount: number } {
  const groups = new Map<string, ConvertibleRow>();
  for (const row of rows) {
    const key = `${row.currency}|${String(row.rate)}|${keyOf(row)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { currency: row.currency, rate: row.rate, sum: row.sum, count: row.count });
    } else {
      group.sum += row.sum;
      group.count += row.count;
    }
  }
  const converted = convertRows([...groups.values()], display, onMissingRate);
  return {
    total: converted.items.reduce((sum, { amount }) => sum + amount, 0n),
    unconvertedCount: converted.unconvertedCount,
  };
}

const EMPTY = {
  movementId: null,
  cardId: null,
  installment: null,
  group: null,
  dueDate: null,
} as const;

/**
 * What one top-level expense category adds up to in a month, item by item, with the rules of the
 * dashboard's month (FR-06): movements and group shares by their day up to today, card purchases
 * and installments by the month their statement is due.
 */
export class GetCategoryDetail {
  constructor(private readonly deps: GetCategoryDetailDependencies) {}

  async execute(scope: AccessScope, query: CategoryDetailQuery): Promise<CategoryDetailResponse> {
    const { month, categoryId } = query;
    const preferences = await this.deps.preferences.preferencesOf(scope.userId);
    const { timeZone, displayCurrency: display } = preferences;
    const known = await this.deps.flows.topCategories(scope);
    const category = known.find((candidate) => candidate.id === categoryId);
    if (category === undefined) throw new ResourceNotFound();

    const today = todayInTimeZone(this.deps.clock.now(), timeZone);
    const first = `${month}-01`;
    const last = lastDayOf(month);
    const until = last < today ? last : today;
    const window =
      first <= until ? { ...localDayBounds(first, until, timeZone), timeZone } : undefined;
    const periodFrom = addMonths(month, -PERIOD_MARGIN);
    const periodTo = addMonths(month, PERIOD_MARGIN);
    const dueInMonth = (row: Parameters<typeof installmentMonthOf>[0]) =>
      installmentMonthOf(row, first, last) === month;

    const { items: reader } = this.deps;
    const [personal, cards, installments, shares] = await Promise.all([
      window === undefined ? [] : reader.personalItems(scope, window, categoryId),
      reader.cardPurchaseItems(scope, periodFrom, periodTo, {
        timeZone,
        topCategoryId: categoryId,
      }),
      reader.installmentItems(scope, periodFrom, periodTo, categoryId),
      window === undefined ? [] : reader.shareItems(scope, window),
    ]);
    const cardsDue = cards.filter(dueInMonth);
    const installmentsDue = installments.filter(dueInMonth);
    const sharesHere = shares.filter(
      (row) =>
        matchShareCategory(
          { name: row.categoryName, defaultKey: row.categoryDefaultKey },
          known,
        ) === categoryId,
    );

    const statementKey = (row: (typeof cardsDue)[number] | (typeof installmentsDue)[number]) =>
      `${row.period}|${String(row.dueDate)}|${row.closingDay}|${row.dueDay}`;
    const parts = [
      groupedTotal(personal, () => '', display, 'throw'),
      groupedTotal(cardsDue, statementKey, display, 'throw'),
      groupedTotal(
        installmentsDue,
        (row) => `${statementKey(row)}|${row.categoryId}`,
        display,
        'count',
      ),
      groupedTotal(sharesHere, (row) => `${row.month}|${row.groupCategoryId}`, display, 'count'),
    ];
    const total = parts.reduce((sum, part) => sum + part.total, 0n);

    const amountOf = (row: ConvertibleRow): string | null =>
      convertRows([row], display, 'count').items[0]?.amount.toString() ?? null;
    const items: CategoryDetailItem[] = [
      ...personal.map((row) => ({
        ...EMPTY,
        key: `movement:${row.movementId}`,
        source: 'movement' as const,
        day: row.day,
        label: row.note,
        category: {
          id: row.categoryId,
          name: row.categoryName,
          defaultKey: row.categoryDefaultKey,
        },
        currency: row.currency,
        originalAmount: row.sum.toString(),
        amount: amountOf(row),
        movementId: row.movementId,
      })),
      ...cardsDue.map((row) => ({
        ...EMPTY,
        key: `card:${row.movementId}`,
        source: 'cardPurchase' as const,
        day: row.day,
        dueDate: installmentDueDate(row),
        label: row.note,
        category: {
          id: row.categoryId,
          name: row.categoryName,
          defaultKey: row.categoryDefaultKey,
        },
        currency: row.currency,
        originalAmount: row.sum.toString(),
        amount: amountOf(row),
        movementId: row.movementId,
      })),
      ...installmentsDue.map((row) => ({
        ...EMPTY,
        key: `installment:${row.purchaseId}:${row.number}`,
        source: 'installment' as const,
        day: row.day,
        dueDate: installmentDueDate(row),
        label: row.note,
        category: {
          id: row.categoryId,
          name: row.categoryName,
          defaultKey: row.categoryDefaultKey,
        },
        currency: row.currency,
        originalAmount: row.sum.toString(),
        amount: amountOf(row),
        cardId: row.cardId,
        installment: { number: row.number, count: row.installmentCount },
      })),
      ...sharesHere.map((row) => ({
        ...EMPTY,
        key: `share:${row.expenseId}`,
        source: 'share' as const,
        day: row.day,
        label: row.description,
        category: null,
        currency: row.currency,
        originalAmount: row.sum.toString(),
        amount: amountOf(row),
        group: { id: row.groupId, name: row.groupName },
      })),
    ].sort((a, b) => (a.day === b.day ? a.key.localeCompare(b.key) : a.day < b.day ? 1 : -1));

    return {
      currency: display,
      month,
      categoryId,
      name: category.name,
      defaultKey: category.defaultKey,
      total: total.toString(),
      items,
      unconvertedShareCount: parts[3]?.unconvertedCount ?? 0,
      unconvertedInstallmentCount: parts[2]?.unconvertedCount ?? 0,
    };
  }
}
