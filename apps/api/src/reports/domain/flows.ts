import { statementDatesFor } from '@pesly/shared';
import { convertAmount, effectiveNames, namesMatch, type FlowCurrency } from './conversion';

/** A grouped row that can be converted: personal rows, share rows and installment rows. */
export interface ConvertibleRow {
  currency: FlowCurrency;
  /** ARS per USD scaled by 10,000; null for an installment and for a share paid by someone else. */
  rate: bigint | null;
  sum: bigint;
  /** How many movements, shares or installments the sum holds. */
  count: number;
}

export interface ConvertedRows<Row extends ConvertibleRow> {
  /** Every row that converted, beside its amount in the display currency. */
  items: { row: Row; amount: bigint }[];
  /** The sum of `count` of the rows that could not convert. */
  unconvertedCount: number;
}

/**
 * Converts each row once. A row that needs a rate it does not have is an invariant error with
 * `'throw'` (personal expenses always carry a frozen rate) and is left out and counted with
 * `'count'` (shares and installments).
 */
export function convertRows<Row extends ConvertibleRow>(
  rows: readonly Row[],
  display: FlowCurrency,
  onMissingRate: 'throw' | 'count',
): ConvertedRows<Row> {
  const items: { row: Row; amount: bigint }[] = [];
  let unconvertedCount = 0;
  for (const row of rows) {
    const amount = convertAmount(row.sum, row.currency, display, row.rate);
    if (amount !== null) {
      items.push({ row, amount });
    } else if (onMissingRate === 'throw') {
      throw new RangeError('A personal row needs a frozen rate');
    } else {
      unconvertedCount += row.count;
    }
  }
  return { items, unconvertedCount };
}

/** A top-level expense category with the names of its children (D7). */
export interface TopCategory {
  id: string;
  name: string | null;
  defaultKey: string | null;
  children: { name: string | null; defaultKey: string | null }[];
  createdAt: Date;
}

function byCreation(a: TopCategory, b: TopCategory): number {
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  if (time !== 0) return time < 0 ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * The personal top-level category a group share goes to: the one whose effective names, or those
 * of its children, match the group category name case-insensitively. Ties go to the earliest
 * created category. Null when none matches.
 */
export function matchShareCategory(
  groupCategory: { name: string | null; defaultKey: string | null },
  categories: readonly TopCategory[],
): string | null {
  const wanted = effectiveNames(groupCategory);
  if (wanted.length === 0) return null;
  const matches = categories.filter((category) =>
    [category, ...category.children].some((own) =>
      effectiveNames(own).some((name) => wanted.some((target) => namesMatch(name, target))),
    ),
  );
  const [first] = [...matches].sort(byCreation);
  return first?.id ?? null;
}

export interface InstallmentDueInput {
  period: string;
  /** The stored statement's due date, or null when the statement is not stored yet. */
  dueDate: string | null;
  closingDay: number;
  dueDay: number;
}

/** The stored due date, or the one derived from the card days (D8). */
export function installmentDueDate(row: InstallmentDueInput): string {
  return row.dueDate ?? statementDatesFor(row.period, row.closingDay, row.dueDay).dueDate;
}

/** The `YYYY-MM` of the due date when it is inside `[from, to]` (both `YYYY-MM-DD`), else null. */
export function installmentMonthOf(
  row: InstallmentDueInput,
  from: string,
  to: string,
): string | null {
  const due = installmentDueDate(row);
  return due >= from && due <= to ? due.slice(0, 7) : null;
}
