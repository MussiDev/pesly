import { describe, expect, it } from 'vitest';
import { UNIT_PRICE_MAX } from '@pesly/shared';
import { usdPriceToMinorUnits } from '../../src/investments/domain/crypto-price';

describe('usdPriceToMinorUnits (AC-01)', () => {
  it('turns a decimal price into whole cents', () => {
    expect(usdPriceToMinorUnits('67890.1234')).toBe(6_789_012n);
  });

  it('handles a fraction below one dollar', () => {
    expect(usdPriceToMinorUnits('0.5')).toBe(50n);
  });

  it('handles an exponent form', () => {
    expect(usdPriceToMinorUnits('1.5e3')).toBe(150_000n);
    expect(usdPriceToMinorUnits('1E2')).toBe(10_000n);
  });

  it('handles an integer price and a leading-zero integer part', () => {
    expect(usdPriceToMinorUnits('3')).toBe(300n);
    expect(usdPriceToMinorUnits('007.25')).toBe(725n);
  });

  it('has no binary float error on classic sums', () => {
    expect(usdPriceToMinorUnits('0.30000000000000004')).toBe(30n);
    expect(usdPriceToMinorUnits('1.15')).toBe(115n);
  });
});

describe('usdPriceToMinorUnits rounding (AC-02)', () => {
  it('rounds half up at the cent', () => {
    expect(usdPriceToMinorUnits('0.005')).toBe(1n);
    expect(usdPriceToMinorUnits('1.005')).toBe(101n);
    expect(usdPriceToMinorUnits('1.004')).toBe(100n);
  });

  it('returns null below half a cent', () => {
    expect(usdPriceToMinorUnits('0.0049')).toBeNull();
  });

  it('returns null for a sub-cent price', () => {
    expect(usdPriceToMinorUnits('0.000007')).toBeNull();
    expect(usdPriceToMinorUnits('1.2e-7')).toBeNull();
  });

  it('handles a negative exponent that still reaches a cent', () => {
    expect(usdPriceToMinorUnits('5e-2')).toBe(5n);
    expect(usdPriceToMinorUnits('12345e-3')).toBe(1_235n);
  });
});

describe('usdPriceToMinorUnits invalid input', () => {
  it.each(['', 'abc', '-1', '0', '0.0', '1e', 'NaN', '.5', '5.', ' 1', '1 ', '+1', '1,5'])(
    'returns null for %j without throwing',
    (text) => {
      expect(() => usdPriceToMinorUnits(text)).not.toThrow();
      expect(usdPriceToMinorUnits(text)).toBeNull();
    },
  );

  it('returns null for an otherwise valid 41-character string', () => {
    const text = '0'.repeat(38) + '1.5';
    expect(text).toHaveLength(41);
    expect(usdPriceToMinorUnits(text)).toBeNull();
  });

  it('accepts an otherwise valid 40-character string', () => {
    const text = '0'.repeat(37) + '1.5';
    expect(text).toHaveLength(40);
    expect(usdPriceToMinorUnits(text)).toBe(150n);
  });

  it('returns null above the unit price limit and accepts the limit', () => {
    const limitDollars = (UNIT_PRICE_MAX / 100n).toString();
    expect(usdPriceToMinorUnits(limitDollars)).toBe(UNIT_PRICE_MAX);
    expect(usdPriceToMinorUnits(`${limitDollars}.01`)).toBeNull();
    expect(usdPriceToMinorUnits('1e30')).toBeNull();
  });

  it('does not blow up on a huge exponent', () => {
    expect(usdPriceToMinorUnits('1e999999999')).toBeNull();
    expect(usdPriceToMinorUnits('1e-999999999')).toBeNull();
  });
});
