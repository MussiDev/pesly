import { RATE_MAX_SCALED } from '../exchange-rates/scaled-rate';

/**
 * ARS-per-USD rate scaled by 10,000, from the ARS and USD amounts in minor units, rounded
 * half-up with `(ars * 20000 + usd) / (2 * usd)` (the rule of `parseScaledRate`). Returns null
 * when the result is outside 1..RATE_MAX_SCALED; throws RangeError for a non-positive argument.
 */
export function impliedRate(arsMinor: bigint, usdMinor: bigint): bigint | null {
  if (arsMinor <= 0n || usdMinor <= 0n) {
    throw new RangeError('Amounts must be positive');
  }
  const rate = (arsMinor * 20_000n + usdMinor) / (2n * usdMinor);
  return rate >= 1n && rate <= RATE_MAX_SCALED ? rate : null;
}
