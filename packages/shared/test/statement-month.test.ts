import { describe, expect, it } from 'vitest';
import { installmentDueDate, statementDueMonth } from '../src/credit-cards/statement-month';

describe('statementDueMonth', () => {
  it('uses the month of the stored due date, even when later than the period (AC-04)', () => {
    const row = { period: '2026-09', dueDate: '2026-11-03', closingDay: 24, dueDay: 5 };
    expect(installmentDueDate(row)).toBe('2026-11-03');
    expect(statementDueMonth(row)).toBe('2026-11');
  });

  it('derives the due date from the closing and due days when none is stored (AC-05)', () => {
    const row = { period: '2026-09', dueDate: null, closingDay: 10, dueDay: 20 };
    expect(installmentDueDate(row)).toBe('2026-09-20');
    expect(statementDueMonth(row)).toBe('2026-09');
  });

  it('places a statement closing 24 Sep and due 5 Oct in 2026-10 (AC-01)', () => {
    const row = { period: '2026-09', dueDate: null, closingDay: 24, dueDay: 5 };
    expect(statementDueMonth(row)).toBe('2026-10');
  });

  it('falls back to the period month when the days are unusable, without failing (AC-14)', () => {
    const row = { period: '2026-09', dueDate: null, closingDay: 0, dueDay: 40 };
    expect(() => statementDueMonth(row)).not.toThrow();
    expect(statementDueMonth(row)).toBe('2026-09');
  });
});
