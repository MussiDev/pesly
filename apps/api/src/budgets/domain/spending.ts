import { defaultCategoryNames, convertMinorUnits, type BudgetCurrency } from '@pesly/shared';

/** The cap of `percentUsed`: a threshold up to 200 is still crossed far below it. */
const PERCENT_USED_CAP = 1000n;

/** Sum of the personal expenses of one (category, currency, frozen rate) group. */
export interface PersonalRow {
  categoryId: string;
  currency: BudgetCurrency;
  /** ARS per USD scaled by 10,000, frozen on the movements; null never happens for a movement. */
  rate: bigint | null;
  sum: bigint;
}

/** Sum of the caller's group shares of one (group category, currency, payer rate) group. */
export interface ShareRow {
  /** Custom name of the group category, or null while a default is untouched. */
  categoryName: string | null;
  categoryDefaultKey: string | null;
  currency: BudgetCurrency;
  /** The caller's own payer movement rate; null when someone else paid. */
  rate: bigint | null;
  sum: bigint;
}

function fold(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * The names a category answers to: its custom name alone once set, otherwise both language names
 * of its default key. The same rule as the categories module, kept here so this module does not
 * import it.
 */
export function effectiveNames(category: {
  name: string | null;
  defaultKey: string | null;
}): string[] {
  if (category.name !== null) return [category.name];
  if (category.defaultKey === null) return [];
  const names = defaultCategoryNames(category.defaultKey);
  return [names.es, names.en];
}

export function namesMatch(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

/** The amount in the target currency, or null when the currencies differ and there is no rate. */
export function convertAmount(
  amount: bigint,
  from: BudgetCurrency,
  to: BudgetCurrency,
  rate: bigint | null,
): bigint | null {
  if (from === to) return amount;
  if (rate === null) return null;
  return convertMinorUnits(amount, from, rate);
}

export function spendingOf(
  budgetCurrency: BudgetCurrency,
  coveredCategoryIds: ReadonlySet<string>,
  coveredNames: readonly string[],
  personalRows: readonly PersonalRow[],
  shareRows: readonly ShareRow[],
): { spent: bigint; unconvertedShareCount: number } {
  const wanted = new Set(coveredNames.map(fold));
  let spent = 0n;
  let unconvertedShareCount = 0;

  for (const row of personalRows) {
    if (!coveredCategoryIds.has(row.categoryId)) continue;
    const converted = convertAmount(row.sum, row.currency, budgetCurrency, row.rate);
    if (converted === null) throw new RangeError('A personal expense needs a frozen rate');
    spent += converted;
  }

  for (const row of shareRows) {
    const names = effectiveNames({ name: row.categoryName, defaultKey: row.categoryDefaultKey });
    if (!names.some((name) => wanted.has(fold(name)))) continue;
    const converted = convertAmount(row.sum, row.currency, budgetCurrency, row.rate);
    if (converted === null) {
      unconvertedShareCount += 1;
      continue;
    }
    spent += converted;
  }

  return { spent, unconvertedShareCount };
}

/** `spent * 100 / available` rounded down, from 0 to 1,000; `available` must be positive. */
export function percentUsed(spent: bigint, available: bigint): number {
  if (available <= 0n) throw new RangeError('The available amount must be positive');
  if (spent <= 0n) return 0;
  const percent = (spent * 100n) / available;
  // At most 1,000, so the integer parse below is exact.
  return Number.parseInt((percent > PERCENT_USED_CAP ? PERCENT_USED_CAP : percent).toString(), 10);
}

export interface BudgetSpendingInput {
  currency: BudgetCurrency;
  current: { amount: bigint; rollover: boolean };
  /** The version in force the previous month, or null when the budget did not exist yet. */
  previous: { amount: bigint } | null;
  spentCurrent: bigint;
  spentPrevious: bigint;
}

export interface BudgetSpendingResult {
  rolloverAmount: bigint;
  available: bigint;
  remaining: bigint;
  percentUsed: number;
}

/** D8: one level of rollover, from the previous month's own amount and spending only. */
export function computeBudgetSpending(input: BudgetSpendingInput): BudgetSpendingResult {
  const leftover =
    input.current.rollover && input.previous !== null
      ? input.previous.amount - input.spentPrevious
      : 0n;
  const rolloverAmount = leftover > 0n ? leftover : 0n;
  const available = input.current.amount + rolloverAmount;
  return {
    rolloverAmount,
    available,
    remaining: available - input.spentCurrent,
    percentUsed: percentUsed(input.spentCurrent, available),
  };
}
