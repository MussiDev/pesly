import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDateTime,
  formatShortDate,
  formatMoney,
  formatPercentage,
  formatQuantity,
} from '../src/lib/format-amount';

describe('formatMoney', () => {
  const NBSP = ' ';

  it('joins the amount and the currency code with a non-breaking space', () => {
    expect(formatMoney(18_500_000n, 'ARS', 'en')).toBe(`185,000.00${NBSP}ARS`);
    expect(formatMoney(18_500_000n, 'ARS', 'es')).toBe(`185.000,00${NBSP}ARS`);
    expect(formatMoney(50_000n, 'USD', 'es')).toBe(`500,00${NBSP}USD`);
  });

  it('handles negative and zero amounts', () => {
    expect(formatMoney(-123_456n, 'USD', 'en')).toBe(`-1,234.56${NBSP}USD`);
    expect(formatMoney(-5n, 'ARS', 'es')).toBe(`-0,05${NBSP}ARS`);
    expect(formatMoney(0n, 'ARS', 'en')).toBe(`0.00${NBSP}ARS`);
  });
});

describe('formatAmount', () => {
  it('formats 18500000 minor units per language (AC-10)', () => {
    expect(formatAmount(18_500_000n, 'en')).toBe('185,000.00');
    expect(formatAmount(18_500_000n, 'es')).toBe('185.000,00');
  });

  it('handles negative, zero and sub-unit amounts (AC-11)', () => {
    expect(formatAmount(-5n, 'es')).toBe('-0,05');
    expect(formatAmount(-5n, 'en')).toBe('-0.05');
    expect(formatAmount(0n, 'es')).toBe('0,00');
    expect(formatAmount(99n, 'en')).toBe('0.99');
    expect(formatAmount(-123_456n, 'en')).toBe('-1,234.56');
  });

  it('is exact above 2^63 (AC-10)', () => {
    expect(formatAmount(2n ** 63n, 'en')).toBe('92,233,720,368,547,758.08');
    expect(formatAmount(2n ** 70n, 'es')).toBe('11.805.916.207.174.113.034,24');
  });
});

describe('formatPercentage', () => {
  it('formats 2333 basis points (AC-11)', () => {
    expect(formatPercentage(2333n, 'en')).toBe('23.33%');
    expect(formatPercentage(2333n, 'es')).toBe('23,33%');
  });

  it('keeps the sign of a loss (AC-11) and pads single digits', () => {
    expect(formatPercentage(-505n, 'en')).toBe('-5.05%');
    expect(formatPercentage(-5n, 'es')).toBe('-0,05%');
    expect(formatPercentage(0n, 'en')).toBe('0.00%');
  });
});

describe('formatQuantity', () => {
  it('uses the language separators without trailing zeros', () => {
    expect(formatQuantity(1_050_000_000n, 'en')).toBe('10.5');
    expect(formatQuantity(1_050_000_000n, 'es')).toBe('10,5');
    expect(formatQuantity(100_000_000_000n, 'en')).toBe('1,000');
    expect(formatQuantity(123_456_789_012_345_678n, 'es')).toBe('1.234.567.890,12345678');
  });

  it('formats quantities below one and zero (AC-02)', () => {
    expect(formatQuantity(1n, 'en')).toBe('0.00000001');
    expect(formatQuantity(50_000_000n, 'es')).toBe('0,5');
    expect(formatQuantity(0n, 'en')).toBe('0');
    expect(formatQuantity(-50_000_000n, 'en')).toBe('-0.5');
  });
});

const EN_UTC = 'Mar 1, 2026, 1:30 AM';
const EN_BA = 'Feb 28, 2026, 10:30 PM';
const ES_UTC = '1 mar 2026, 1:30 a. m.';
const ES_BA = '28 feb 2026, 10:30 p. m.';

describe('formatDateTime', () => {
  const iso = '2026-03-01T01:30:00.000Z';
  const buenosAires = 'America/Argentina/Buenos_Aires';

  it('renders the same instant in the given time zone (AC-08)', () => {
    expect(formatDateTime(iso, 'UTC', 'en')).toBe(EN_UTC);
    expect(formatDateTime(iso, buenosAires, 'en')).toBe(EN_BA);
  });

  it('follows the language (AC-08)', () => {
    expect(formatDateTime(iso, 'UTC', 'es')).toBe(ES_UTC);
    expect(formatDateTime(iso, buenosAires, 'es')).toBe(ES_BA);
  });
});

describe('formatShortDate', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');

  it('shows the day and month in the user time zone, without the year of the current one', () => {
    expect(formatShortDate('2026-10-06T15:00:00.000Z', 'UTC', 'en', now)).toBe('Oct 6');
    // 01:00 UTC is still the day before in Buenos Aires.
    expect(
      formatShortDate('2026-10-06T01:00:00.000Z', 'America/Argentina/Buenos_Aires', 'en', now),
    ).toBe('Oct 5');
  });

  it('adds the year when it is not the current one', () => {
    expect(formatShortDate('2025-12-31T15:00:00.000Z', 'UTC', 'en', now)).toBe('Dec 31, 2025');
  });
});
