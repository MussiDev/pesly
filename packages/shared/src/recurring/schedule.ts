/**
 * Due-date rules of a recurring payment (DISC-001-08a FR-02, FR-03). Everything works on
 * `YYYY-MM-DD` strings with UTC date math at noon, so the server time zone never matters; the
 * caller computes "today" in the user's time zone.
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

/** The fields of a recurring payment that decide when it is due. Weekday: Monday = 0. */
export interface ScheduleRule {
  frequency: RecurringFrequency;
  weekday?: number | null | undefined;
  dayOfMonth?: number | null | undefined;
  month?: number | null | undefined;
  startDate: string;
  endDate?: string | null | undefined;
}

const DAY_MS = 86_400_000;
/** A yearly rule always has a due date within a year; one extra leap day of margin. */
const LOOKAHEAD_DAYS = 400;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const toInt = (text: string): number => parseInt(text, 10);

function parseDay(day: string): { year: number; month: number; day: number } {
  const [year = '', month = '', date = ''] = day.split('-');
  return { year: toInt(year), month: toInt(month), day: toInt(date) };
}

const format = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

const toUtcNoon = (day: string): number => {
  const parts = parseDay(day);
  return Date.UTC(parts.year, parts.month - 1, parts.day, 12);
};

function fromUtcNoon(time: number): string {
  const date = new Date(time);
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0, 12)).getUTCDate();

/** The day in that month, or the month's last day when absent (29 February becomes 28). */
export function clampDay(year: number, month: number, day: number): string {
  return format(year, month, Math.min(day, lastDayOfMonth(year, month)));
}

export function addDays(day: string, n: number): string {
  return fromUtcNoon(toUtcNoon(day) + n * DAY_MS);
}

/** Monday = 0 ... Sunday = 6. */
function weekdayOf(day: string): number {
  return (new Date(toUtcNoon(day)).getUTCDay() + 6) % 7;
}

function weeklyDates(weekday: number, from: string, to: string): string[] {
  const dates: string[] = [];
  let current = addDays(from, (weekday - weekdayOf(from) + 7) % 7);
  while (current <= to) {
    dates.push(current);
    current = addDays(current, 7);
  }
  return dates;
}

function monthlyDates(dayOfMonth: number, from: string, to: string): string[] {
  const start = parseDay(from);
  const end = parseDay(to);
  const dates: string[] = [];
  for (
    let index = start.year * 12 + start.month - 1;
    index <= end.year * 12 + end.month - 1;
    index++
  ) {
    const date = clampDay(Math.floor(index / 12), (index % 12) + 1, dayOfMonth);
    if (date >= from && date <= to) dates.push(date);
  }
  return dates;
}

function yearlyDates(month: number, dayOfMonth: number, from: string, to: string): string[] {
  const dates: string[] = [];
  for (let year = parseDay(from).year; year <= parseDay(to).year; year++) {
    const date = clampDay(year, month, dayOfMonth);
    if (date >= from && date <= to) dates.push(date);
  }
  return dates;
}

/**
 * Due dates in `fromDay`..`toDay` inclusive, ascending, only inside the rule's own
 * `startDate`..`endDate`. An empty window gives an empty list.
 */
export function dueDatesBetween(rule: ScheduleRule, fromDay: string, toDay: string): string[] {
  const from = fromDay > rule.startDate ? fromDay : rule.startDate;
  const to = rule.endDate != null && rule.endDate < toDay ? rule.endDate : toDay;
  if (from > to) return [];
  switch (rule.frequency) {
    case 'weekly':
      return weeklyDates(rule.weekday ?? 0, from, to);
    case 'monthly':
      return monthlyDates(rule.dayOfMonth ?? 1, from, to);
    case 'yearly':
      return yearlyDates(rule.month ?? 1, rule.dayOfMonth ?? 1, from, to);
  }
}

/** The first due date on or after `fromDay`, or `null` once the rule has ended. */
export function nextDueDate(rule: ScheduleRule, fromDay: string): string | null {
  const from = fromDay > rule.startDate ? fromDay : rule.startDate;
  return dueDatesBetween(rule, from, addDays(from, LOOKAHEAD_DAYS))[0] ?? null;
}
