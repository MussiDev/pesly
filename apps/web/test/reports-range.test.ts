import { describe, expect, it } from 'vitest';
import { activePreset, checkRange, presetsFor, rangeOfPreset } from '../src/features/reports/range';

describe('report range presets (FR-13)', () => {
  it('last 3 months from 2026-10-12 starts 2026-08-01 and ends today (AC-28)', () => {
    expect(rangeOfPreset('last3', '2026-10-12')).toEqual({ from: '2026-08-01', to: '2026-10-12' });
  });

  it('this month starts on the first day of the month of today', () => {
    expect(rangeOfPreset('thisMonth', '2026-10-12')).toEqual({
      from: '2026-10-01',
      to: '2026-10-12',
    });
  });

  it('last 12 and 24 months start 11 and 23 months before', () => {
    expect(rangeOfPreset('last12', '2026-10-12').from).toBe('2025-11-01');
    expect(rangeOfPreset('last24', '2026-10-12').from).toBe('2024-11-01');
  });

  it('crosses a year boundary', () => {
    expect(rangeOfPreset('last3', '2026-01-15')).toEqual({ from: '2025-11-01', to: '2026-01-15' });
    expect(rangeOfPreset('last12', '2026-01-31').from).toBe('2025-02-01');
  });

  it('in a leap-year February ends on day 29 and starts on the first of a month', () => {
    expect(rangeOfPreset('last3', '2028-02-29')).toEqual({ from: '2027-12-01', to: '2028-02-29' });
    expect(rangeOfPreset('thisMonth', '2028-02-29')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('income against expenses offers no last-24 preset; the other two do (AC-29)', () => {
    expect(presetsFor('incomeExpenses')).toEqual(['thisMonth', 'last3', 'last12']);
    expect(presetsFor('categories')).toContain('last24');
    expect(presetsFor('netWorth')).toContain('last24');
  });
});

describe('activePreset', () => {
  it('no from and no to is the default preset of the report', () => {
    expect(activePreset({}, '2026-10-12', 'categories')).toBe('thisMonth');
    expect(activePreset({}, '2026-10-12', 'incomeExpenses')).toBe('last12');
    expect(activePreset({}, '2026-10-12', 'netWorth')).toBe('last12');
  });

  it('dates that match a preset select it, others are custom', () => {
    expect(activePreset({ from: '2026-08-01', to: '2026-10-12' }, '2026-10-12', 'categories')).toBe(
      'last3',
    );
    expect(activePreset({ from: '2026-08-02', to: '2026-10-12' }, '2026-10-12', 'categories')).toBe(
      'custom',
    );
    expect(activePreset({ from: '2026-08-01' }, '2026-10-12', 'categories')).toBe('custom');
  });

  it('a last-24 range is custom on income against expenses', () => {
    expect(
      activePreset({ from: '2024-11-01', to: '2026-10-12' }, '2026-10-12', 'incomeExpenses'),
    ).toBe('custom');
  });
});

describe('checkRange (FR-15)', () => {
  const today = '2026-10-12';

  it('from after to gives from_after_to (AC-32)', () => {
    expect(checkRange({ from: '2026-10-10', to: '2026-10-01', today, kind: 'categories' })).toEqual(
      { ok: false, reason: 'from_after_to' },
    );
  });

  it('13 months on income against expenses gives too_long with 12 (AC-33)', () => {
    expect(
      checkRange({ from: '2025-10-01', to: '2026-10-12', today, kind: 'incomeExpenses' }),
    ).toEqual({ ok: false, reason: 'too_long', maxMonths: 12 });
  });

  it('12 months on income against expenses and 24 on the others are accepted', () => {
    expect(checkRange({ from: '2025-11-01', to: today, today, kind: 'incomeExpenses' })).toEqual({
      ok: true,
    });
    expect(checkRange({ from: '2024-11-01', to: today, today, kind: 'netWorth' })).toEqual({
      ok: true,
    });
    expect(checkRange({ from: '2024-10-01', to: today, today, kind: 'categories' })).toEqual({
      ok: false,
      reason: 'too_long',
      maxMonths: 24,
    });
  });

  it('a missing end uses today, and no dates at all is ok', () => {
    expect(checkRange({ from: '2026-10-20', today, kind: 'categories' })).toEqual({
      ok: false,
      reason: 'from_after_to',
    });
    expect(checkRange({ today, kind: 'categories' })).toEqual({ ok: true });
    expect(checkRange({ to: '2026-09-30', today, kind: 'netWorth' })).toEqual({ ok: true });
  });
});

describe('checkRange end in the future (L1)', () => {
  it('rejects an end date later than today before anything else', () => {
    expect(
      checkRange({ from: '2026-10-01', to: '2026-10-13', today: '2026-10-12', kind: 'categories' }),
    ).toEqual({ ok: false, reason: 'to_in_future' });
    expect(checkRange({ to: '2026-10-13', today: '2026-10-12', kind: 'netWorth' })).toEqual({
      ok: false,
      reason: 'to_in_future',
    });
  });

  it('accepts today as the end', () => {
    expect(
      checkRange({ from: '2026-10-01', to: '2026-10-12', today: '2026-10-12', kind: 'categories' }),
    ).toEqual({ ok: true });
  });
});
