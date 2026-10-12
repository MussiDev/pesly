import { todayInTimeZone, zonedLocalToInstant } from '@pesly/shared';

/** The first day of the month of `now` in the user's time zone, as `YYYY-MM-01` (PRD 01 FR-24). */
export function currentMonthStart(now: Date, timeZone: string): string {
  return `${todayInTimeZone(now, timeZone).slice(0, 7)}-01`;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4}-\d{2})-\d{2}$/;

function parseMonth(month: string): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) throw new RangeError('The month must be YYYY-MM');
  return { year: Number.parseInt(match[1] ?? '', 10), month: Number.parseInt(match[2] ?? '', 10) };
}

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** The `YYYY-MM` of a `YYYY-MM-DD` date. */
export function monthOf(isoDate: string): string {
  const match = DATE_PATTERN.exec(isoDate);
  if (match === null) throw new RangeError('The date must be YYYY-MM-DD');
  const month = match[1] ?? '';
  parseMonth(month);
  return month;
}

export function previousMonth(month: string): string {
  const parsed = parseMonth(month);
  return parsed.month === 1
    ? formatMonth(parsed.year - 1, 12)
    : formatMonth(parsed.year, parsed.month - 1);
}

function nextMonth(month: string): string {
  const parsed = parseMonth(month);
  return parsed.month === 12
    ? formatMonth(parsed.year + 1, 1)
    : formatMonth(parsed.year, parsed.month + 1);
}

/** The first day of the month, as `YYYY-MM-01`. */
export function monthStartOf(month: string): string {
  parseMonth(month);
  return `${month}-01`;
}

function startInstant(month: string, timeZone: string): Date {
  // Midnight can be skipped by a daylight-saving jump; 01:00 is the first hour that exists then.
  const instant =
    zonedLocalToInstant(`${month}-01T00:00`, timeZone) ??
    zonedLocalToInstant(`${month}-01T01:00`, timeZone);
  if (instant === null) throw new RangeError('The start of the month does not exist in the zone');
  return instant;
}

/** The UTC instants `[from, to)` that bound the month in the user's time zone (D2). */
export function monthBounds(month: string, timeZone: string): { from: Date; to: Date } {
  parseMonth(month);
  return { from: startInstant(month, timeZone), to: startInstant(nextMonth(month), timeZone) };
}
