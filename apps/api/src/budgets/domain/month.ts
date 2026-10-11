import { todayInTimeZone } from '@pesly/shared';

/** The first day of the month of `now` in the user's time zone, as `YYYY-MM-01` (PRD 01 FR-24). */
export function currentMonthStart(now: Date, timeZone: string): string {
  return `${todayInTimeZone(now, timeZone).slice(0, 7)}-01`;
}
