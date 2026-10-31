import { describe, expect, it } from 'vitest';
import {
  MINOR_UNITS_MAX,
  MINOR_UNITS_MIN,
  addExact,
  addMinorUnits,
  exactIntegerStringSchema,
  formatMinorUnitsString,
  formatMoney,
  minorUnitsStringSchema,
  parseAmountInput,
  parseMinorUnits,
  sumExact,
  sumMinorUnits,
} from '@pesly/shared';

describe('exact arithmetic for derived values', () => {
  it('sumExact over 100,000 amounts of 10^15 equals exactly 10^20 with no error', () => {
    const values = Array.from({ length: 100_000 }, () => 10n ** 15n);
    expect(sumExact(values)).toBe(10n ** 20n);
  });

  it('sumExact of an empty list is 0n', () => {
    expect(sumExact([])).toBe(0n);
  });

  it('addExact of two int64 maxima equals twice the maximum with no error', () => {
    expect(addExact(MINOR_UNITS_MAX, MINOR_UNITS_MAX)).toBe(MINOR_UNITS_MAX * 2n);
    expect(addExact(MINOR_UNITS_MIN, MINOR_UNITS_MIN)).toBe(MINOR_UNITS_MIN * 2n);
  });

  it('exactIntegerStringSchema accepts integers beyond int64 up to 40 digits', () => {
    expect(exactIntegerStringSchema.safeParse('0').success).toBe(true);
    expect(exactIntegerStringSchema.safeParse('-12').success).toBe(true);
    expect(exactIntegerStringSchema.safeParse('9223372036854775808').success).toBe(true);
    expect(exactIntegerStringSchema.safeParse('9'.repeat(40)).success).toBe(true);
    expect(exactIntegerStringSchema.safeParse(`-${'9'.repeat(40)}`).success).toBe(true);
  });

  it('exactIntegerStringSchema rejects 41 digits, decimals, junk and non-strings', () => {
    expect(exactIntegerStringSchema.safeParse('9'.repeat(41)).success).toBe(false);
    for (const bad of ['1.5', '1e3', '', '-', 'abc', '007', '-0x1', ' 1']) {
      expect(exactIntegerStringSchema.safeParse(bad).success).toBe(false);
    }
    expect(exactIntegerStringSchema.safeParse(5).success).toBe(false);
  });
});

describe('sumMinorUnits', () => {
  it('sums 100,000 generated bigint amounts to the exact total', () => {
    // amount(i) = i * 1_000_003 - 7 for i in 1..100000. Closed form: 1_000_003 * n(n+1)/2 - 7n.
    const n = 100_000n;
    const values: bigint[] = [];
    for (let i = 1n; i <= n; i += 1n) values.push(i * 1_000_003n - 7n);
    const expected = (1_000_003n * n * (n + 1n)) / 2n - 7n * n;
    expect(sumMinorUnits(values)).toBe(expected);
  });

  it('returns 0n for an empty list', () => {
    expect(sumMinorUnits([])).toBe(0n);
  });

  it('throws RangeError when the running total leaves int64', () => {
    expect(() => sumMinorUnits([MINOR_UNITS_MAX, 1n])).toThrow(RangeError);
  });
});

describe('addMinorUnits', () => {
  it('adds within range, including the limits', () => {
    expect(addMinorUnits(MINOR_UNITS_MAX, 0n)).toBe(MINOR_UNITS_MAX);
    expect(addMinorUnits(MINOR_UNITS_MIN, 0n)).toBe(MINOR_UNITS_MIN);
    expect(addMinorUnits(-5n, 3n)).toBe(-2n);
  });

  it('throws RangeError on positive overflow', () => {
    expect(() => addMinorUnits(MINOR_UNITS_MAX, 1n)).toThrow(RangeError);
  });

  it('throws RangeError on negative overflow', () => {
    expect(() => addMinorUnits(MINOR_UNITS_MIN, -1n)).toThrow(RangeError);
  });
});

describe('int64 constants and string helpers', () => {
  it('exposes the signed 64-bit bounds', () => {
    expect(MINOR_UNITS_MAX).toBe(9223372036854775807n);
    expect(MINOR_UNITS_MIN).toBe(-9223372036854775808n);
  });

  it('round-trips parseMinorUnits and formatMinorUnitsString', () => {
    expect(parseMinorUnits('-150000')).toBe(-150000n);
    expect(formatMinorUnitsString(-150000n)).toBe('-150000');
  });

  it('parseMinorUnits throws on malformed or out-of-range input', () => {
    for (const bad of ['1.5', '', 'abc', '01', '9223372036854775808', '-9223372036854775809']) {
      expect(() => parseMinorUnits(bad)).toThrow();
    }
  });

  it('minorUnitsStringSchema accepts the bounds and rejects out of range or malformed', () => {
    expect(minorUnitsStringSchema.safeParse('9223372036854775807').success).toBe(true);
    expect(minorUnitsStringSchema.safeParse('-9223372036854775808').success).toBe(true);
    expect(minorUnitsStringSchema.safeParse('9223372036854775808').success).toBe(false);
    expect(minorUnitsStringSchema.safeParse('-9223372036854775809').success).toBe(false);
    for (const bad of ['1.5', '1e3', '', '01', '-0x', ' 1', '+1', 'abc']) {
      expect(minorUnitsStringSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('formatMoney', () => {
  it('formats es-AR with period grouping and comma decimals', () => {
    expect(formatMoney(123456n, 'ARS', 'es-AR')).toContain('1.234,56');
  });

  it('formats en with comma grouping and period decimals', () => {
    expect(formatMoney(123456n, 'USD', 'en')).toContain('1,234.56');
  });

  it('is exact beyond float precision', () => {
    expect(formatMoney(9007199254740993n, 'USD', 'en')).toContain('90,071,992,547,409.93');
  });

  it('always shows the ISO code after the amount, joined by a non-breaking space', () => {
    expect(formatMoney(120000n, 'USD', 'es')).toBe('1.200,00\u00a0USD');
    expect(formatMoney(120000n, 'USD', 'en-US')).toBe('1,200.00\u00a0USD');
  });

  it('groups four-digit amounts in Spanish too', () => {
    expect(formatMoney(150000n, 'ARS', 'es-AR')).toBe('1.500,00\u00a0ARS');
  });

  it('keeps the sign for negatives smaller than one unit', () => {
    const text = formatMoney(-5n, 'USD', 'en');
    expect(text).toContain('0.05');
    expect(text).toMatch(/-|−/);
    const es = formatMoney(-5n, 'ARS', 'es-AR');
    expect(es).toContain('0,05');
    expect(es).toMatch(/-|−/);
  });
});

describe('parseAmountInput', () => {
  it('reads 1.234,56 as 123456n in es-AR', () => {
    expect(parseAmountInput('1.234,56', 'es-AR')).toBe(123456n);
  });

  it('reads 1,234.56 as 123456n in en', () => {
    expect(parseAmountInput('1,234.56', 'en')).toBe(123456n);
  });

  it('handles integers, one decimal and a leading minus', () => {
    expect(parseAmountInput('10', 'es-AR')).toBe(1000n);
    expect(parseAmountInput('10,5', 'es-AR')).toBe(1050n);
    expect(parseAmountInput('-1.234,56', 'es-AR')).toBe(-123456n);
    expect(parseAmountInput('0', 'en')).toBe(0n);
  });

  it('round-trips formatMoney output for es-AR and en', () => {
    for (const [locale, currency] of [
      ['es-AR', 'ARS'],
      ['en', 'USD'],
    ] as const) {
      for (const value of [0n, 5n, 100n, 123456n, -987654321n]) {
        const text = formatMoney(value, currency, locale)
          .replace('−', '-')
          .replace(/[^\d.,-]/g, '');
        expect(parseAmountInput(text, locale)).toBe(value);
      }
    }
  });

  it('reads -1.500,00 as -150000n in es', () => {
    expect(parseAmountInput('-1.500,00', 'es')).toBe(-150000n);
  });

  it('returns null outside the int64 range', () => {
    expect(parseAmountInput('92233720368547758,08', 'es-AR')).toBeNull();
    expect(parseAmountInput('-92233720368547758,09', 'es-AR')).toBeNull();
    expect(parseAmountInput('92233720368547758,07', 'es-AR')).toBe(MINOR_UNITS_MAX);
    expect(parseAmountInput('-92233720368547758,08', 'es-AR')).toBe(MINOR_UNITS_MIN);
  });

  it('returns null for three decimals in es-AR', () => {
    expect(parseAmountInput('12,345', 'es-AR')).toBeNull();
  });

  it('returns null for abc, empty, whitespace, lone separators and junk', () => {
    for (const bad of ['abc', '', '  ', ',', '.', '-', '1,2,3', '1..2', '--1', '1a']) {
      expect(parseAmountInput(bad, 'es-AR')).toBeNull();
    }
  });
});
