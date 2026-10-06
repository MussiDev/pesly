import { exactIntegerStringSchema } from '@pesly/shared';

export interface CompositionSegment {
  instrumentType: string;
  /** Integer share of the currency's total, in basis points; a currency sums to exactly 10000n. */
  basisPoints: bigint;
}

export interface CurrencyComposition {
  currency: string;
  segments: CompositionSegment[];
}

interface PricedHolding {
  instrumentType: string;
  valuationCurrency: string;
  /** Minor-unit string from the API, or `null` when the holding has no price. */
  value: string | null;
}

const WHOLE = 10_000n;

/**
 * Shares of each valuation currency's value by instrument type. Currencies are never added to one
 * another. A value that is missing, not an exact integer or not positive is left out. Shares come
 * from integer division; the leftover basis points go to the largest share so the total is exact.
 */
export function composeByInstrumentType(holdings: readonly PricedHolding[]): CurrencyComposition[] {
  const byCurrency = new Map<string, Map<string, bigint>>();
  for (const holding of holdings) {
    if (holding.value === null) continue;
    const parsed = exactIntegerStringSchema.safeParse(holding.value);
    if (!parsed.success) continue;
    const value = BigInt(parsed.data);
    if (value <= 0n) continue;
    const types = byCurrency.get(holding.valuationCurrency) ?? new Map<string, bigint>();
    types.set(holding.instrumentType, (types.get(holding.instrumentType) ?? 0n) + value);
    byCurrency.set(holding.valuationCurrency, types);
  }
  return [...byCurrency].map(([currency, types]) => ({ currency, segments: sharesOf(types) }));
}

/** Largest first, ties by type, so the order never depends on how the API listed the holdings. */
function sharesOf(types: ReadonlyMap<string, bigint>): CompositionSegment[] {
  const entries = [...types].sort(([typeA, valueA], [typeB, valueB]) => {
    if (valueA !== valueB) return valueA > valueB ? -1 : 1;
    return typeA < typeB ? -1 : typeA > typeB ? 1 : 0;
  });
  const total = entries.reduce((sum, [, value]) => sum + value, 0n);
  const floors = entries.map(([, value]) => (value * WHOLE) / total);
  const leftover = WHOLE - floors.reduce((sum, floor) => sum + floor, 0n);
  return entries.map(([instrumentType], index) => {
    const base = floors[index] ?? 0n;
    return { instrumentType, basisPoints: index === 0 ? base + leftover : base };
  });
}
