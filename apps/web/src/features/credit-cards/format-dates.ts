// Statement dates are calendar dates with no time zone, so they are formatted as UTC midnight:
// any other zone could show the day before.

/** `YYYY-MM-DD` in the locale's medium date style. */
export function formatCalendarDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** `YYYY-MM` as the locale's month and year, for example "October 2026". */
export function formatPeriod(period: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`));
}
