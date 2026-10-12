import { describe, expect, it } from 'vitest';
import { monthPeriods } from '../../src/dashboard/domain/period';

describe('monthPeriods', () => {
  it('describes the current month, the previous period and the three months before', () => {
    expect(monthPeriods('2026-10-15')).toEqual({
      month: '2026-10',
      first: '2026-10-01',
      monthEnd: '2026-10-31',
      previousMonth: '2026-09',
      previousFrom: '2026-09-01',
      previousTo: '2026-09-15',
      previousEnd: '2026-09-30',
      history: ['2026-07', '2026-08', '2026-09'],
    });
  });

  it('clamps the previous period end to the last day of the previous month', () => {
    expect(monthPeriods('2026-03-31').previousTo).toBe('2026-02-28');
    expect(monthPeriods('2028-03-31').previousTo).toBe('2028-02-29');
    expect(monthPeriods('2026-04-30').previousTo).toBe('2026-03-30');
    expect(monthPeriods('2026-05-31').previousTo).toBe('2026-04-30');
  });

  it('crosses the year boundary', () => {
    const periods = monthPeriods('2026-01-10');
    expect(periods.previousMonth).toBe('2025-12');
    expect(periods.previousFrom).toBe('2025-12-01');
    expect(periods.history).toEqual(['2025-10', '2025-11', '2025-12']);
  });

  it('knows the end of February', () => {
    expect(monthPeriods('2028-02-10').monthEnd).toBe('2028-02-29');
    expect(monthPeriods('2026-02-10').monthEnd).toBe('2026-02-28');
  });
});
