import { convertMinorUnits } from '@pesly/shared';
import type { CurrencyAmounts } from './installment-debt';

export interface AssemblePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `YYYY-MM`. */
  month: string;
}

export interface AssembledPoint {
  date: string;
  ars: bigint;
  usd: bigint;
  total: bigint | null;
  reason: 'no_rate' | null;
  investmentsIncomplete: boolean;
}

export interface AssembleInput {
  points: readonly AssemblePoint[];
  accounts: {
    opening: CurrencyAmounts;
    baseline: CurrencyAmounts;
    byMonth: ReadonlyMap<string, CurrencyAmounts>;
  };
  groups: { baseline: CurrencyAmounts; byMonth: ReadonlyMap<string, CurrencyAmounts> };
  investments: {
    values: ReadonlyMap<string, CurrencyAmounts>;
    incompleteDates: ReadonlySet<string>;
  };
  debt: ReadonlyMap<string, CurrencyAmounts>;
  /** The sell rate per point date; null or absent when there is none. */
  rates: ReadonlyMap<string, bigint | null>;
  displayCurrency: 'ARS' | 'USD';
}

const ZERO: CurrencyAmounts = { ARS: 0n, USD: 0n };

/**
 * The running amount at each point month: the start amounts plus every bucket whose month is not
 * after the point's. `months` must be in ascending order.
 */
export function accumulate(
  opening: CurrencyAmounts,
  baseline: CurrencyAmounts,
  byMonth: ReadonlyMap<string, CurrencyAmounts>,
  months: readonly string[],
): Map<string, CurrencyAmounts> {
  const buckets = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const running: CurrencyAmounts = {
    ARS: opening.ARS + baseline.ARS,
    USD: opening.USD + baseline.USD,
  };
  const result = new Map<string, CurrencyAmounts>();
  let next = 0;
  for (const month of months) {
    while (next < buckets.length && (buckets[next]?.[0] ?? '') <= month) {
      const amounts = buckets[next]?.[1] ?? ZERO;
      running.ARS += amounts.ARS;
      running.USD += amounts.USD;
      next += 1;
    }
    result.set(month, { ...running });
  }
  return result;
}

export function assemblePoints(input: AssembleInput): AssembledPoint[] {
  const months = input.points.map((point) => point.month);
  const accounts = accumulate(
    input.accounts.opening,
    input.accounts.baseline,
    input.accounts.byMonth,
    months,
  );
  const groups = accumulate(ZERO, input.groups.baseline, input.groups.byMonth, months);

  return input.points.map((point) => {
    const account = accounts.get(point.month) ?? ZERO;
    const group = groups.get(point.month) ?? ZERO;
    const investment = input.investments.values.get(point.date) ?? ZERO;
    const debt = input.debt.get(point.date) ?? ZERO;
    const ars = account.ARS + investment.ARS + group.ARS - debt.ARS;
    const usd = account.USD + investment.USD + group.USD - debt.USD;
    const base = {
      date: point.date,
      ars,
      usd,
      investmentsIncomplete: input.investments.incompleteDates.has(point.date),
    };

    const home = input.displayCurrency === 'ARS' ? ars : usd;
    const foreign = input.displayCurrency === 'ARS' ? usd : ars;
    if (foreign === 0n) return { ...base, total: home, reason: null };
    const rate = input.rates.get(point.date) ?? null;
    if (rate === null) return { ...base, total: null, reason: 'no_rate' as const };
    const converted =
      input.displayCurrency === 'ARS'
        ? convertMinorUnits(usd, 'USD', rate)
        : convertMinorUnits(ars, 'ARS', rate);
    return { ...base, total: home + converted, reason: null };
  });
}
