import { QUANTITY_SCALE, STALE_PRICE_AFTER_MS, type ValuationCurrency } from './constants';

const BASIS_POINTS = 10_000n;

/** Value in minor units, rounded half up. */
export function holdingValue(quantity: bigint, unitPrice: bigint): bigint {
  return (quantity * unitPrice + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}

export interface GainOrLoss {
  amount: bigint;
  /** Signed basis points: 2333 is 23.33%. */
  basisPoints: bigint;
}

/**
 * Requires `totalCost` > 0n (a holding without a cost basis has no gain); throws RangeError
 * otherwise. The percentage rounds half away from zero.
 */
export function gainOrLoss(value: bigint, totalCost: bigint): GainOrLoss {
  if (totalCost <= 0n) throw new RangeError('totalCost must be greater than 0');
  const amount = value - totalCost;
  const numerator = amount * BASIS_POINTS;
  let basisPoints = numerator / totalCost;
  const remainder = numerator % totalCost;
  const twiceRemainder = remainder < 0n ? -remainder * 2n : remainder * 2n;
  if (twiceRemainder >= totalCost) basisPoints += numerator < 0n ? -1n : 1n;
  return { amount, basisPoints };
}

export function isPriceStale(pricedAt: Date, now: Date): boolean {
  return now.getTime() - pricedAt.getTime() > STALE_PRICE_AFTER_MS;
}

export interface ValuedHolding {
  valuationCurrency: ValuationCurrency;
  value: bigint | null;
}

/** Holdings without a value (no price) are left out of the sums. */
export function totalsByCurrency(
  holdings: readonly ValuedHolding[],
): Record<ValuationCurrency, bigint> {
  const totals: Record<ValuationCurrency, bigint> = { ARS: 0n, USD: 0n };
  for (const holding of holdings) {
    if (holding.value !== null) totals[holding.valuationCurrency] += holding.value;
  }
  return totals;
}

/**
 * True when the market price is more than 5% away from the manual one, measured against the
 * manual price; exactly 5% is false. Integers only, so there is no rounding to argue about.
 */
export function marketPriceDiffers(manualUnitPrice: bigint, marketUnitPrice: bigint): boolean {
  const difference = marketUnitPrice - manualUnitPrice;
  const distance = difference < 0n ? -difference : difference;
  return distance * 100n > manualUnitPrice * 5n;
}
