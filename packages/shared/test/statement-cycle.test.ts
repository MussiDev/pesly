import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  firstOpenPeriod,
  isCalendarDate,
  isStatementClosed,
  nextPeriod,
  previousPeriod,
  statementDatesFor,
} from '../src/credit-cards/statement-cycle';

describe('statementDatesFor', () => {
  it('closes on the default day and is due on the next occurrence of the due day (AC-04)', () => {
    expect(statementDatesFor('2026-10', 24, 5)).toEqual({
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
  });

  it('uses the last day of a short month for the closing day (AC-05, FR-04)', () => {
    expect(statementDatesFor('2027-02', 31, 10).closingDate).toBe('2027-02-28');
    expect(statementDatesFor('2028-02', 31, 10).closingDate).toBe('2028-02-29');
    expect(statementDatesFor('2026-04', 31, 10).closingDate).toBe('2026-04-30');
  });

  it('keeps the due date in the closing month when it falls after the closing date (FR-03)', () => {
    expect(statementDatesFor('2026-10', 10, 25)).toEqual({
      closingDate: '2026-10-10',
      dueDate: '2026-10-25',
    });
  });

  it('clamps the due day to the last day of its month and rolls an equal day over (FR-04)', () => {
    expect(statementDatesFor('2026-11', 24, 31).dueDate).toBe('2026-11-30');
    expect(statementDatesFor('2026-10', 24, 24).dueDate).toBe('2026-11-24');
    expect(statementDatesFor('2026-11', 30, 31).dueDate).toBe('2026-12-31');
    expect(statementDatesFor('2027-01', 31, 31).dueDate).toBe('2027-02-28');
  });

  it('crosses the year boundary for a December statement', () => {
    expect(statementDatesFor('2026-12', 24, 5)).toEqual({
      closingDate: '2026-12-24',
      dueDate: '2027-01-05',
    });
  });

  it('throws RangeError for an impossible period or day (error path)', () => {
    expect(() => statementDatesFor('2026-13', 24, 5)).toThrow(RangeError);
    expect(() => statementDatesFor('26-10', 24, 5)).toThrow(RangeError);
    expect(() => statementDatesFor('2026-10', 0, 5)).toThrow(RangeError);
    expect(() => statementDatesFor('2026-10', 24, 32)).toThrow(RangeError);
    expect(() => statementDatesFor('2026-10', 1.5, 5)).toThrow(RangeError);
  });
});

describe('periods', () => {
  it('moves to the next and previous month across years', () => {
    expect(nextPeriod('2026-10')).toBe('2026-11');
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(previousPeriod('2027-01')).toBe('2026-12');
    expect(previousPeriod('2026-10')).toBe('2026-09');
  });

  it('counts the days of each month, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('picks the open cycle: this month on or before the closing day, the next after it (FR-03)', () => {
    expect(firstOpenPeriod('2026-10-06', 24)).toBe('2026-10');
    expect(firstOpenPeriod('2026-10-24', 24)).toBe('2026-10');
    expect(firstOpenPeriod('2026-10-25', 24)).toBe('2026-11');
    expect(firstOpenPeriod('2026-12-28', 24)).toBe('2027-01');
    expect(firstOpenPeriod('2027-02-28', 31)).toBe('2027-02');
  });

  it('throws RangeError for a malformed today (error path)', () => {
    expect(() => firstOpenPeriod('2026-10-32', 24)).toThrow(RangeError);
  });
});

describe('isStatementClosed', () => {
  it('is open on its closing date and closed from the next day (AC-09, FR-07)', () => {
    expect(isStatementClosed('2026-10-24', '2026-10-23')).toBe(false);
    expect(isStatementClosed('2026-10-24', '2026-10-24')).toBe(false);
    expect(isStatementClosed('2026-10-24', '2026-10-25')).toBe(true);
    expect(isStatementClosed('2026-12-31', '2027-01-01')).toBe(true);
  });
});

describe('isCalendarDate', () => {
  it('accepts real dates and rejects impossible or malformed ones (invalid input)', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('2026-1-05')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-00-10')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});
