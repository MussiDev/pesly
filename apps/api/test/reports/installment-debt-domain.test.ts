import { describe, expect, it } from 'vitest';
import {
  installmentDebt,
  type InstallmentDebtRow,
} from '../../src/reports/domain/installment-debt';

const POINTS = [
  { date: '2026-05-31', month: '2026-05' },
  { date: '2026-06-30', month: '2026-06' },
  { date: '2026-07-31', month: '2026-07' },
];

function row(overrides: Partial<InstallmentDebtRow>): InstallmentDebtRow {
  return {
    period: '2026-06',
    closingDate: null,
    closingDay: 20,
    dueDay: 5,
    purchaseMonth: '2026-04',
    currency: 'ARS',
    sum: 1000000n,
    ...overrides,
  };
}

describe('installmentDebt', () => {
  it('(AC-35, AC-36) subtracts the installments whose statement closes after the point, from stored or derived dates', () => {
    const rows = [
      // Stored closing date after 2026-06-30.
      row({ period: '2026-07', closingDate: '2026-07-20' }),
      // Derived closing date: period 2026-08, closing day 20 -> 2026-08-20.
      row({ period: '2026-08' }),
      // Closed on or before the month end: not subtracted.
      row({ period: '2026-06', closingDate: '2026-06-20' }),
      row({ period: '2026-06', closingDate: '2026-06-30', sum: 5n }),
    ];
    const debt = installmentDebt(rows, POINTS);

    expect(debt.get('2026-06-30')).toEqual({ ARS: 2000000n, USD: 0n });
    // At the end of May the 2026-06 statements are still open as well.
    expect(debt.get('2026-05-31')).toEqual({ ARS: 3000005n, USD: 0n });
    // At the end of July only the 2026-08 statement is open.
    expect(debt.get('2026-07-31')).toEqual({ ARS: 1000000n, USD: 0n });
  });

  it('leaves out a purchase made after the point month', () => {
    const rows = [row({ period: '2026-09', purchaseMonth: '2026-07' })];
    const debt = installmentDebt(rows, POINTS);

    expect(debt.get('2026-05-31')).toEqual({ ARS: 0n, USD: 0n });
    expect(debt.get('2026-06-30')).toEqual({ ARS: 0n, USD: 0n });
    expect(debt.get('2026-07-31')).toEqual({ ARS: 1000000n, USD: 0n });
  });

  it('keeps the currencies apart', () => {
    const rows = [row({ currency: 'USD', sum: 7n, period: '2026-09' })];
    expect(installmentDebt(rows, POINTS).get('2026-06-30')).toEqual({ ARS: 0n, USD: 7n });
  });

  it('returns an entry per point even with no rows', () => {
    const debt = installmentDebt([], POINTS);
    expect([...debt.keys()]).toEqual(['2026-05-31', '2026-06-30', '2026-07-31']);
  });

  it('throws on a row with an invalid period', () => {
    expect(() => installmentDebt([row({ period: '2026-13' })], POINTS)).toThrow(/period/i);
    expect(() => installmentDebt([row({ period: 'soon' })], POINTS)).toThrow(/period/i);
  });

  it('is invalid for an unknown currency', () => {
    expect(() => installmentDebt([row({ currency: 'EUR' })], POINTS)).toThrow(/currency/i);
  });
});
