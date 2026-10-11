import { RATE_SCALE } from '../exchange-rates/scaled-rate';

export type ConvertibleCurrency = 'ARS' | 'USD';

/**
 * Converts minor units of `from` to minor units of the other currency at `rate`, ARS per USD
 * scaled by 10,000: ARS to USD is `amount * 10,000 / rate`, USD to ARS is `amount * rate / 10,000`.
 * Rounds half up on the absolute value, so the result is symmetric around 0.
 */
export function convertMinorUnits(amount: bigint, from: ConvertibleCurrency, rate: bigint): bigint {
  if (rate <= 0n) throw new RangeError('The rate must be positive');
  const magnitude = amount < 0n ? -amount : amount;
  const numerator = from === 'ARS' ? magnitude * RATE_SCALE : magnitude * rate;
  const divisor = from === 'ARS' ? rate : RATE_SCALE;
  const rounded = (2n * numerator + divisor) / (2n * divisor);
  return amount < 0n ? -rounded : rounded;
}
