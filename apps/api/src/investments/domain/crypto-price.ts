import { UNIT_PRICE_MAX } from '@pesly/shared';

export interface PriceQuote {
  /** Lowercase CoinGecko symbol. */
  symbol: string;
  /** US cents. */
  unitPrice: bigint;
}

const PRICE_TEXT = /^([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;
const MAX_TEXT_LENGTH = 40;
// Far beyond any storable price; it only keeps BigInt powers small.
const MAX_EXPONENT = 1000n;

/**
 * Converts the source text of a JSON price in US dollars to whole US cents, rounded half up,
 * working on the digits so no binary float is ever involved. Null means "no usable price".
 */
export function usdPriceToMinorUnits(text: string): bigint | null {
  if (text.length > MAX_TEXT_LENGTH) return null;
  const match = PRICE_TEXT.exec(text);
  if (match === null) return null;

  const [, whole = '', fraction = '', exponentText = '0'] = match;
  const mantissa = BigInt(whole + fraction);
  if (mantissa === 0n) return null;

  const exponent = BigInt(exponentText);
  if (exponent > MAX_EXPONENT || exponent < -MAX_EXPONENT) return null;

  // dollars = mantissa * 10^(exponent - fraction digits); cents add 2 more.
  const shift = exponent - BigInt(fraction.length) + 2n;
  let cents: bigint;
  if (shift >= 0n) {
    if (shift > 13n) return null;
    cents = mantissa * 10n ** shift;
  } else {
    const divisor = 10n ** -shift;
    cents = (mantissa * 2n + divisor) / (divisor * 2n);
  }

  if (cents < 1n || cents > UNIT_PRICE_MAX) return null;
  return cents;
}
