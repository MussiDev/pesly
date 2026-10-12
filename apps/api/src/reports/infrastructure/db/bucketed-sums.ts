import { sql } from 'drizzle-orm';
import type { CurrencyAmounts } from '../../domain/installment-debt';

export interface BucketedSumRow extends Record<string, unknown> {
  currency: string;
  /** `YYYY-MM` in the user's zone; null before the window. */
  bucket: string | null;
  total: string;
}

/** The instants are bound as ISO text, so the driver never formats a `Date` in the server zone. */
export const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

export function emptyAmounts(): CurrencyAmounts {
  return { ARS: 0n, USD: 0n };
}

export function assertCurrency(value: string): 'ARS' | 'USD' {
  if (value === 'ARS' || value === 'USD') return value;
  throw new Error(`Unknown currency "${value}"`);
}

/** The month bucket of the `at` column: null before `start`, else `YYYY-MM` in `timeZone`. */
export function bucketOfAt(start: Date, timeZone: string) {
  return sql`case when at < ${instant(start)} then null
    else to_char(at at time zone ${timeZone}::text, 'YYYY-MM') end`;
}

/** Folds `(currency, bucket, total)` rows into a baseline and per-month amounts. */
export function foldBuckets(rows: readonly BucketedSumRow[]): {
  baseline: CurrencyAmounts;
  byMonth: Map<string, CurrencyAmounts>;
} {
  const baseline = emptyAmounts();
  const byMonth = new Map<string, CurrencyAmounts>();
  for (const row of rows) {
    const currency = assertCurrency(row.currency);
    const total = BigInt(row.total);
    if (row.bucket === null) {
      baseline[currency] += total;
      continue;
    }
    const month = byMonth.get(row.bucket) ?? emptyAmounts();
    month[currency] += total;
    byMonth.set(row.bucket, month);
  }
  return { baseline, byMonth };
}
