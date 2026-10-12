import { describe, expect, it } from 'vitest';
import {
  AppError,
  REPORT_MAX_MONTHS,
  addMonths,
  localDayBounds,
  monthsBetween,
  monthsInRange,
  netWorthPointDates,
  resolveReportRange,
  startOfLocalDay,
} from '../src';

const BA = 'America/Argentina/Buenos_Aires';
const TODAY = '2026-09-15';

function resolve(
  limit: keyof typeof REPORT_MAX_MONTHS,
  input: { from?: string; to?: string },
  defaultMonths = 12,
) {
  return resolveReportRange({
    ...input,
    today: TODAY,
    maxMonths: REPORT_MAX_MONTHS[limit],
    defaultMonths,
  });
}

function catchError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected an error');
}

describe('monthsBetween and addMonths', () => {
  it('counts 2025-01-31 to 2025-02-01 as 2 touched months (AC-04)', () => {
    expect(monthsBetween('2025-01-31', '2025-02-01')).toBe(2);
    expect(monthsBetween('2025-03-01', '2025-03-31')).toBe(1);
    expect(monthsBetween('2025-01-01', '2026-12-31')).toBe(24);
  });

  it('adds and subtracts calendar months across years', () => {
    expect(addMonths('2026-02', 11)).toBe('2027-01');
    expect(addMonths('2026-02', -2)).toBe('2025-12');
    expect(addMonths('2026-02', 0)).toBe('2026-02');
  });

  it('lists the months of a range in order', () => {
    expect(monthsInRange('2025-11-20', '2026-02-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('resolveReportRange', () => {
  it('rejects 25 touched months for the 24 limits and 13 for income and expenses (AC-04, AC-06)', () => {
    for (const limit of ['expensesByCategory', 'netWorth'] as const) {
      const error = catchError(() => resolve(limit, { from: '2024-08-01', to: '2026-08-31' }));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.fields).toContain('query.from');
      expect(error.details).toEqual({ maxMonths: '24' });
    }
    const error = catchError(() =>
      resolve('incomeExpenses', { from: '2025-08-01', to: '2026-08-31' }),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ maxMonths: '12' });
  });

  it('accepts exactly 24 and 12 months (AC-06)', () => {
    expect(resolve('expensesByCategory', { from: '2024-09-01', to: '2026-08-31' }).months).toBe(24);
    expect(resolve('netWorth', { from: '2024-09-30', to: '2026-08-01' }).months).toBe(24);
    expect(resolve('incomeExpenses', { from: '2025-09-01', to: '2026-08-31' }).months).toBe(12);
  });

  it('rejects a from after to and a to after today, naming the field (AC-05)', () => {
    const after = catchError(() =>
      resolve('incomeExpenses', { from: '2026-05-02', to: '2026-05-01' }),
    );
    expect(after.code).toBe('VALIDATION_FAILED');
    expect(after.fields).toContain('query.from');
    const future = catchError(() =>
      resolve('incomeExpenses', { from: '2026-05-01', to: '2026-09-16' }),
    );
    expect(future.code).toBe('VALIDATION_FAILED');
    expect(future.fields).toContain('query.to');
    expect(resolve('incomeExpenses', { from: '2026-09-01', to: TODAY }).to).toBe(TODAY);
  });

  it('defaults to 12 months ending today for income and expenses (AC-07)', () => {
    expect(resolve('incomeExpenses', {})).toEqual({ from: '2025-10-01', to: TODAY, months: 12 });
  });

  it('defaults to the current month with defaultMonths 1 and honors a lone to or from', () => {
    expect(resolve('expensesByCategory', {}, 1)).toEqual({
      from: '2026-09-01',
      to: TODAY,
      months: 1,
    });
    expect(resolve('incomeExpenses', { to: '2026-03-10' })).toEqual({
      from: '2025-04-01',
      to: '2026-03-10',
      months: 12,
    });
    expect(resolve('incomeExpenses', { from: '2026-01-05' })).toEqual({
      from: '2026-01-05',
      to: TODAY,
      months: 9,
    });
  });
});

describe('netWorthPointDates', () => {
  it('returns 12 month ends in order for 2025-10 to 2026-09 (AC-09)', () => {
    const points = netWorthPointDates(monthsInRange('2025-10-01', '2026-09-30'), '2026-12-15');
    expect(points).toHaveLength(12);
    expect(points[0]).toBe('2025-10-31');
    expect(points[1]).toBe('2025-11-30');
    expect(points[11]).toBe('2026-09-30');
    expect([...points].sort()).toEqual(points);
  });

  it('ends February of a leap year on the 29th', () => {
    expect(netWorthPointDates(['2027-02', '2028-02'], '2030-01-01')).toEqual([
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('dates the current month point today and keeps past month ends (AC-42)', () => {
    expect(netWorthPointDates(['2026-08', '2026-09'], TODAY)).toEqual(['2026-08-31', TODAY]);
  });
});

describe('startOfLocalDay and localDayBounds', () => {
  it('spans March 2026 in Buenos Aires from 03:00Z to 03:00Z of April (AC-14)', () => {
    const bounds = localDayBounds('2026-03-01', '2026-03-31', BA);
    expect(bounds.from.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect(bounds.before.toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('uses the first valid hour when a clock change skips local midnight', () => {
    // Sao Paulo skipped 00:00 on 2018-11-04 (DST started at midnight): first valid time is 01:00.
    expect(startOfLocalDay('2018-11-04', 'America/Sao_Paulo').toISOString()).toBe(
      '2018-11-04T03:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-01', BA).toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });
});
