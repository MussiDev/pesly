import { describe, expect, it } from 'vitest';
import {
  QUANTITY_SCALE,
  STALE_PRICE_AFTER_MS,
  gainOrLoss,
  holdingValue,
  isPriceStale,
  marketPriceDiffers,
  totalsByCurrency,
} from '@pesly/shared';

const SCALE = QUANTITY_SCALE;

describe('holdingValue (AC-10)', () => {
  it('10 units at 18,500.00 values 185,000.00', () => {
    expect(holdingValue(10n * SCALE, 1_850_000n)).toBe(18_500_000n);
  });

  it('rounds half up at the minor unit', () => {
    expect(holdingValue(1n, 50_000_000n)).toBe(1n);
    expect(holdingValue(1n, 49_999_999n)).toBe(0n);
    expect(holdingValue(3n, 50_000_000n)).toBe(2n);
  });
});

describe('gainOrLoss (AC-11)', () => {
  it('gain of 35,000.00 and 2333 basis points for cost 150,000.00', () => {
    expect(gainOrLoss(18_500_000n, 15_000_000n)).toEqual({
      amount: 3_500_000n,
      basisPoints: 2333n,
    });
  });

  it('a loss is negative', () => {
    expect(gainOrLoss(10_000_000n, 15_000_000n)).toEqual({
      amount: -5_000_000n,
      basisPoints: -3333n,
    });
  });

  it('rounds half away from zero in both directions', () => {
    expect(gainOrLoss(4001n, 4000n).basisPoints).toBe(3n);
    expect(gainOrLoss(3999n, 4000n).basisPoints).toBe(-3n);
  });

  it.each([0n, -1n, -15_000_000n])('throws RangeError for total cost %s', (cost) => {
    expect(() => gainOrLoss(100n, cost)).toThrow(RangeError);
  });
});

describe('totalsByCurrency (AC-13, AC-20)', () => {
  it('sums per currency and leaves out holdings without value', () => {
    const totals = totalsByCurrency([
      { valuationCurrency: 'ARS', value: 18_500_000n },
      { valuationCurrency: 'ARS', value: 1_500_000n },
      { valuationCurrency: 'USD', value: 50_000n },
      { valuationCurrency: 'USD', value: null },
    ]);
    expect(totals).toEqual({ ARS: 20_000_000n, USD: 50_000n });
  });

  it('is zero for a currency with no valued holdings', () => {
    expect(totalsByCurrency([{ valuationCurrency: 'ARS', value: null }])).toEqual({
      ARS: 0n,
      USD: 0n,
    });
  });
});

describe('isPriceStale (AC-14)', () => {
  // Independent literal on purpose: 7 days in milliseconds, so the shared constant cannot drift.
  const week = 604_800_000;
  const pricedAt = new Date('2026-01-01T00:00:00.000Z');

  it('is false at exactly 7 days and true one millisecond later', () => {
    expect(isPriceStale(pricedAt, new Date(pricedAt.getTime() + week))).toBe(false);
    expect(isPriceStale(pricedAt, new Date(pricedAt.getTime() + week + 1))).toBe(true);
  });

  it('uses the shared constant as the threshold', () => {
    expect(STALE_PRICE_AFTER_MS).toBe(week);
    const at = new Date(pricedAt.getTime() + STALE_PRICE_AFTER_MS);
    expect(isPriceStale(pricedAt, at)).toBe(false);
  });
});

describe('marketPriceDiffers (AC-07, AC-08, AC-09)', () => {
  it('is true when the market price is 6.67% above or below the manual one', () => {
    expect(marketPriceDiffers(6_000_000n, 6_400_000n)).toBe(true);
    expect(marketPriceDiffers(6_000_000n, 5_600_000n)).toBe(true);
  });

  it('is false at exactly 5% above or below (the boundary is inclusive of "no warning")', () => {
    expect(marketPriceDiffers(6_000_000n, 6_300_000n)).toBe(false);
    expect(marketPriceDiffers(6_000_000n, 5_700_000n)).toBe(false);
  });

  it('is true one minor unit past 5% and false one unit short of it', () => {
    expect(marketPriceDiffers(6_000_000n, 6_300_001n)).toBe(true);
    expect(marketPriceDiffers(6_000_000n, 5_699_999n)).toBe(true);
    expect(marketPriceDiffers(6_000_000n, 6_299_999n)).toBe(false);
    expect(marketPriceDiffers(6_000_000n, 5_700_001n)).toBe(false);
  });

  it('is false for equal prices', () => {
    expect(marketPriceDiffers(6_000_000n, 6_000_000n)).toBe(false);
  });

  it('measures against the manual price, not the market one', () => {
    // 1,052 is 5.2% above 1,000 but 1,000 is only 4.94% below 1,052.
    expect(marketPriceDiffers(1_000n, 1_052n)).toBe(true);
    expect(marketPriceDiffers(1_052n, 1_000n)).toBe(false);
  });

  it('does not overflow at the 10^12 limit', () => {
    const limit = 10n ** 12n;
    expect(marketPriceDiffers(limit, limit)).toBe(false);
    expect(marketPriceDiffers(limit, 1n)).toBe(true);
    expect(marketPriceDiffers(1n, limit)).toBe(true);
    expect(marketPriceDiffers(limit, limit - limit / 20n)).toBe(false);
    expect(marketPriceDiffers(limit, limit - limit / 20n - 1n)).toBe(true);
  });
});
