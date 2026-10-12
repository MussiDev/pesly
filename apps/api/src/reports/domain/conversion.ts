import { convertMinorUnits, defaultCategoryNames } from '@pesly/shared';

/**
 * The conversion rules of the budgets (DISC-001-06c), copied so this module imports no other
 * module's domain; `test/reports/budget-parity.test.ts` keeps both in step.
 */
export type FlowCurrency = 'ARS' | 'USD';

function assertCurrency(currency: string): void {
  if (currency !== 'ARS' && currency !== 'USD') {
    throw new RangeError(`Unknown currency: ${currency}`);
  }
}

function fold(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * The names a category answers to: its custom name alone once set, otherwise both language names
 * of its default key.
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

/**
 * The amount in the target currency: unchanged for the same currency, converted with the frozen
 * rate otherwise, and null when the currencies differ and there is no rate.
 */
export function convertAmount(
  amount: bigint,
  from: FlowCurrency,
  to: FlowCurrency,
  rate: bigint | null,
): bigint | null {
  assertCurrency(from);
  assertCurrency(to);
  if (from === to) return amount;
  if (rate === null) return null;
  return convertMinorUnits(amount, from, rate);
}
