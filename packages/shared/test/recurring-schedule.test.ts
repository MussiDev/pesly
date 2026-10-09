import { describe, expect, it } from 'vitest';
import {
  addDays,
  clampDay,
  dueDatesBetween,
  nextDueDate,
  type ScheduleRule,
} from '../src/recurring/schedule';

const monthly = (dayOfMonth: number, extra: Partial<ScheduleRule> = {}): ScheduleRule => ({
  frequency: 'monthly',
  dayOfMonth,
  startDate: '2026-01-01',
  ...extra,
});

describe('clampDay and addDays', () => {
  it('clamps to the last day of a short month (AC-04)', () => {
    expect(clampDay(2027, 2, 31)).toBe('2027-02-28');
    expect(clampDay(2028, 2, 31)).toBe('2028-02-29');
    expect(clampDay(2027, 4, 31)).toBe('2027-04-30');
    expect(clampDay(2027, 1, 31)).toBe('2027-01-31');
  });

  it('turns 29 February of a non-leap year into 28 February (AC-05)', () => {
    expect(clampDay(2027, 2, 29)).toBe('2027-02-28');
    expect(clampDay(2028, 2, 29)).toBe('2028-02-29');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-09', 0)).toBe('2026-10-09');
  });
});

describe('dueDatesBetween', () => {
  it('monthly day 31 yields the clamped end of short months (AC-04)', () => {
    expect(dueDatesBetween(monthly(31), '2027-01-01', '2027-04-30')).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(dueDatesBetween(monthly(31), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('yearly 29 February yields 28 February in non-leap years (AC-05)', () => {
    const rule: ScheduleRule = {
      frequency: 'yearly',
      dayOfMonth: 29,
      month: 2,
      startDate: '2026-01-01',
    };
    expect(dueDatesBetween(rule, '2027-01-01', '2028-12-31')).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('weekly Monday over four weeks yields four dates, boundaries inclusive', () => {
    const rule: ScheduleRule = { frequency: 'weekly', weekday: 0, startDate: '2026-01-01' };
    // 2026-10-05 is a Monday.
    expect(dueDatesBetween(rule, '2026-10-05', '2026-11-01')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(dueDatesBetween(rule, '2026-10-06', '2026-11-02')).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('weekly Sunday is weekday 6', () => {
    const rule: ScheduleRule = { frequency: 'weekly', weekday: 6, startDate: '2026-01-01' };
    expect(dueDatesBetween(rule, '2026-10-05', '2026-10-11')).toEqual(['2026-10-11']);
  });

  it('never returns dates before startDate or after endDate', () => {
    const rule: ScheduleRule = {
      frequency: 'weekly',
      weekday: 0,
      startDate: '2026-10-12',
      endDate: '2026-10-26',
    };
    expect(dueDatesBetween(rule, '2026-09-01', '2026-12-31')).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  it('returns an empty list for an empty window', () => {
    expect(dueDatesBetween(monthly(5), '2026-10-10', '2026-10-09')).toEqual([]);
    expect(dueDatesBetween(monthly(5), '2026-10-06', '2026-11-04')).toEqual([]);
  });
});

describe('nextDueDate', () => {
  it('returns the next date from a given day, inclusive', () => {
    expect(nextDueDate(monthly(5), '2026-10-05')).toBe('2026-10-05');
    expect(nextDueDate(monthly(5), '2026-10-06')).toBe('2026-11-05');
    expect(nextDueDate(monthly(5, { startDate: '2027-03-01' }), '2026-10-06')).toBe('2027-03-05');
  });

  it('returns null after endDate', () => {
    const rule = monthly(5, { endDate: '2026-12-31' });
    expect(nextDueDate(rule, '2026-12-06')).toBeNull();
    expect(nextDueDate(rule, '2026-12-05')).toBe('2026-12-05');
  });

  it('finds a yearly date years ahead', () => {
    const rule: ScheduleRule = {
      frequency: 'yearly',
      dayOfMonth: 29,
      month: 2,
      startDate: '2026-01-01',
    };
    expect(nextDueDate(rule, '2028-03-01')).toBe('2029-02-28');
  });
});
