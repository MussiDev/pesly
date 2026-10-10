// Statement dates are calendar dates with no time zone, so they are formatted as UTC midnight:
// any other zone could show the day before.

/** `YYYY-MM-DD` in the locale's medium date style. */
export function formatCalendarDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** `YYYY-MM-DD` as day and short month, for example "20 oct": the year is clear from context. */
export function formatShortDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** `YYYY-MM` as the locale's month and year, for example "October 2026". */
export function formatPeriod(period: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`));
}

/** The day of the month of a `YYYY-MM-DD` calendar date, without a leading zero. */
export function calendarDay(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** The short month of a `YYYY-MM-DD` calendar date, for example "oct". */
export function shortMonth(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`))
    .replace('.', '');
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS);
}

/**
 * How far a billing cycle has gone: the day of the cycle, its length and the filled share (0-1).
 * The cycle starts the day after the previous closing; with none, a month before this closing.
 */
export function cycleProgress(
  closingDate: string,
  previousClosingDate: string | undefined,
  today: string,
): { day: number; length: number; ratio: number } {
  const end = dayNumber(closingDate);
  const start =
    previousClosingDate === undefined
      ? dayNumber(`${closingDate.slice(0, 7)}-01`)
      : dayNumber(previousClosingDate) + 1;
  const length = Math.max(1, end - start + 1);
  const day = Math.min(length, Math.max(1, dayNumber(today) - start + 1));
  return { day, length, ratio: day / length };
}
