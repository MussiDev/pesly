import { describe, expect, it } from 'vitest';
import { calendarDay, cycleProgress, shortMonth } from '../src/features/credit-cards/format-dates';

describe('cycleProgress', () => {
  it('starts the day after the previous closing and counts the day of the cycle', () => {
    // 24 Sep to 23 Oct is a 30-day cycle; 8 Oct is its 15th day.
    expect(cycleProgress('2026-10-23', '2026-09-23', '2026-10-08')).toEqual({
      day: 15,
      length: 30,
      ratio: 0.5,
    });
  });

  it('starts at the first of the month when there is no previous statement', () => {
    expect(cycleProgress('2026-10-20', undefined, '2026-10-10')).toEqual({
      day: 10,
      length: 20,
      ratio: 0.5,
    });
  });

  it('stays inside the cycle when today is before its start or after its end', () => {
    expect(cycleProgress('2026-10-23', '2026-09-23', '2026-09-01').day).toBe(1);
    expect(cycleProgress('2026-10-23', '2026-09-23', '2026-11-30').ratio).toBe(1);
  });
});

describe('calendar date parts', () => {
  it('returns the day without a leading zero and the short month', () => {
    expect(calendarDay('2026-10-04')).toBe('4');
    expect(shortMonth('2026-10-04', 'en')).toBe('Oct');
  });
});
