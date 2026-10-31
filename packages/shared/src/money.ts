import { z } from 'zod';
import { formatMinorUnits } from './money/format-minor-units';

/** Signed 64-bit range of a `bigint` PostgreSQL column; amounts are minor units (centavos). */
export const MINOR_UNITS_MAX = 9223372036854775807n;
export const MINOR_UNITS_MIN = -9223372036854775808n;

const MINOR_UNITS_PATTERN = /^-?(0|[1-9]\d*)$/;

function inRange(value: bigint): boolean {
  return value >= MINOR_UNITS_MIN && value <= MINOR_UNITS_MAX;
}

/** A decimal integer string inside the int64 range: how amounts travel in JSON. */
export const minorUnitsStringSchema = z
  .string()
  .refine((text) => MINOR_UNITS_PATTERN.test(text) && inRange(BigInt(text)), {
    message: 'Amount must be an integer string within the signed 64-bit range',
  });

const EXACT_INTEGER_PATTERN = /^-?(0|[1-9]\d{0,39})$/;

/**
 * A decimal integer string of at most 40 digits with no int64 range. Only for derived values that
 * are never stored (balances, totals); stored amounts use `minorUnitsStringSchema`.
 */
export const exactIntegerStringSchema = z
  .string()
  .refine((text) => EXACT_INTEGER_PATTERN.test(text), {
    message: 'Value must be an integer string of at most 40 digits',
  });

export function parseMinorUnits(text: string): bigint {
  return BigInt(minorUnitsStringSchema.parse(text));
}

export function formatMinorUnitsString(value: bigint): string {
  return value.toString();
}

export function addMinorUnits(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (!inRange(result)) {
    throw new RangeError('Amount is outside the signed 64-bit range');
  }
  return result;
}

export function sumMinorUnits(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) {
    total = addMinorUnits(total, value);
  }
  return total;
}

/** Plain bigint addition with no range check: for derived values that are never stored. */
export function addExact(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Plain bigint sum with no range check and no RangeError: for derived values never stored. */
export function sumExact(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) {
    total = addExact(total, value);
  }
  return total;
}

const NBSP = '\u00a0';

/**
 * Formats minor units for display as `<amount> <currency code>`, e.g. `1.234,56 ARS` or
 * `1,234.56 USD`, joined by a non-breaking space so the code never wraps away from the number.
 * Always groups thousands and always shows the ISO code (never `US$` or `$`), so the same money
 * reads the same on every screen. String arithmetic only: no float is created.
 */
export function formatMoney(value: bigint, currency: string, locale: string): string {
  const language = locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  return `${formatMinorUnits(value, language)}${NBSP}${currency}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a user-typed amount in the locale's own notation (group and decimal separators come from
 * Intl). Returns minor units, or `null` for anything malformed, with more than two decimals, or
 * outside the int64 range.
 */
export function parseAmountInput(text: string, locale: string): bigint | null {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.8);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const g = escapeRegExp(group);
  const d = escapeRegExp(decimal);
  const pattern = new RegExp(`^(-)?(\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d{1,2}))?$`);
  const match = pattern.exec(text.trim());
  if (match === null) return null;
  const [, sign, intPart = '', fraction = ''] = match;
  const digits = intPart.split(group).join('');
  const magnitude = BigInt(digits) * 100n + BigInt(fraction.padEnd(2, '0'));
  const value = sign === '-' ? -magnitude : magnitude;
  return inRange(value) ? value : null;
}
