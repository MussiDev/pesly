import { dateInTimeZone, zonedLocalToInstant } from '@pesly/shared';

/** Months offered by the picker: the current one and the 120 before it (10 years). */
export const OFFERED_MONTHS = 121;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseMonth(month: string): { year: number; index: number } {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) throw new RangeError(`Invalid month: ${month}`);
  return {
    year: Number.parseInt(match[1] ?? '', 10),
    index: Number.parseInt(match[2] ?? '', 10) - 1,
  };
}

function monthOf(year: number, index: number): string {
  const absolute = year * 12 + index;
  const y = Math.floor(absolute / 12);
  const m = absolute - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** `YYYY-MM` of now in the user's time zone. */
export function currentMonth(now: Date, timeZone: string): string {
  return dateInTimeZone(now, timeZone).slice(0, 7);
}

/** The current month and the 120 before it, newest first; never a future month. */
export function offeredMonths(now: Date, timeZone: string): string[] {
  const { year, index } = parseMonth(currentMonth(now, timeZone));
  return Array.from({ length: OFFERED_MONTHS }, (_, back) => monthOf(year, index - back));
}

/** First instant of the local day 1, skipping a skipped local midnight (clock changes). */
function firstInstant(month: string, timeZone: string): Date {
  for (let hour = 0; hour < 24; hour += 1) {
    const instant = zonedLocalToInstant(
      `${month}-01T${String(hour).padStart(2, '0')}:00`,
      timeZone,
    );
    if (instant !== null) return instant;
  }
  throw new RangeError(`No instant for month: ${month}`);
}

/** Inclusive bounds as ISO instants: the month's first instant to 1 ms before the next month's. */
export function monthBounds(month: string, timeZone: string): { from: string; to: string } {
  const { year, index } = parseMonth(month);
  const from = firstInstant(month, timeZone);
  const next = firstInstant(monthOf(year, index + 1), timeZone);
  return { from: from.toISOString(), to: new Date(next.getTime() - 1).toISOString() };
}
