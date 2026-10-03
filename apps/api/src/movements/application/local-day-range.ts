import { zonedLocalToInstant } from '@pesly/shared';

export interface LocalDayRange {
  /** Inclusive: the start of the local day of `from`. */
  occurredFrom?: Date;
  /** Exclusive: the start of the local day after `to`. */
  occurredBefore?: Date;
}

/** The calendar day after `YYYY-MM-DD`; UTC arithmetic on a date with no time of day has no DST. */
function nextDay(day: string): string {
  const year = Number.parseInt(day.slice(0, 4), 10);
  const month = Number.parseInt(day.slice(5, 7), 10);
  const date = Number.parseInt(day.slice(8, 10), 10);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** Midnight can be skipped by a clock change; the day then starts at its first valid hour. */
function startOfLocalDay(day: string, timeZone: string): Date {
  for (let hour = 0; hour < 24; hour += 1) {
    const instant = zonedLocalToInstant(`${day}T${String(hour).padStart(2, '0')}:00`, timeZone);
    if (instant !== null) return instant;
  }
  throw new RangeError('local day has no valid hour');
}

/** Local calendar days (`YYYY-MM-DD`, both inclusive) as a half-open interval of instants. */
export function localDayRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): LocalDayRange {
  return {
    ...(from === undefined ? {} : { occurredFrom: startOfLocalDay(from, timeZone) }),
    ...(to === undefined ? {} : { occurredBefore: startOfLocalDay(nextDay(to), timeZone) }),
  };
}
