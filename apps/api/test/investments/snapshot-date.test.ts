import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDateOf, previousDate } from '../../src/investments/domain/snapshot-date';

describe('localDateOf (AC-03)', () => {
  it('is 2026-03-01 in Buenos Aires and 2026-03-02 in UTC around local midnight', () => {
    const instant = new Date('2026-03-02T01:30:00Z');
    expect(localDateOf(instant, 'America/Argentina/Buenos_Aires')).toBe('2026-03-01');
    expect(localDateOf(instant, 'UTC')).toBe('2026-03-02');
  });

  it('flips to the next day exactly at local midnight', () => {
    expect(localDateOf(new Date('2026-03-02T02:59:59Z'), 'America/Argentina/Buenos_Aires')).toBe(
      '2026-03-01',
    );
    expect(localDateOf(new Date('2026-03-02T03:00:00Z'), 'America/Argentina/Buenos_Aires')).toBe(
      '2026-03-02',
    );
  });

  it('zero-pads month and day', () => {
    expect(localDateOf(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe('2026-01-05');
  });

  it('raises RangeError for an unknown zone', () => {
    expect(() => localDateOf(new Date('2026-03-02T00:00:00Z'), 'Mars/Olympus')).toThrow(RangeError);
  });

  describe('when the formatter lacks a date part', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each(['year', 'month', 'day'])('throws a clear error without the %s part', (missing) => {
      const all = [
        { type: 'month', value: '03' },
        { type: 'literal', value: '/' },
        { type: 'day', value: '02' },
        { type: 'literal', value: '/' },
        { type: 'year', value: '2026' },
      ] as Intl.DateTimeFormatPart[];
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
        return {
          formatToParts: () => all.filter((p) => p.type !== missing),
        } as unknown as Intl.DateTimeFormat;
      });
      expect(() => localDateOf(new Date('2026-03-02T00:00:00Z'), 'UTC')).toThrow(
        new RegExp(`missing the ${missing} part`),
      );
    });
  });
});

describe('previousDate (AC-03)', () => {
  it('goes back one day inside a month', () => {
    expect(previousDate('2026-03-15')).toBe('2026-03-14');
  });

  it('crosses a month boundary', () => {
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2026-05-01')).toBe('2026-04-30');
  });

  it('crosses a year boundary', () => {
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(previousDate('2024-03-01')).toBe('2024-02-29');
    expect(previousDate('2024-02-29')).toBe('2024-02-28');
    expect(previousDate('2100-03-01')).toBe('2100-02-28');
    expect(previousDate('2000-03-01')).toBe('2000-02-29');
  });

  it.each(['', 'abc', '2026-3-1', '2026-03-01 ', '20260301', '2026-03-01T00:00', '-2026-03-01'])(
    'rejects %j with a RangeError',
    (input) => {
      expect(() => previousDate(input)).toThrow(RangeError);
      expect(() => previousDate(input)).toThrow(/YYYY-MM-DD/);
    },
  );
});
