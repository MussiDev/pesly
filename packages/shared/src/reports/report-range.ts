import { AppError } from '../errors';
import { zonedLocalToInstant } from '../time/zoned-time';

export const REPORT_MAX_MONTHS = {
  expensesByCategory: 24,
  incomeExpenses: 12,
  netWorth: 24,
} as const;

/** A range the report refuses; always a `VALIDATION_FAILED` that names the failing query field. */
export class ReportRangeError extends AppError {
  constructor(fields: string[], details?: Record<string, string>) {
    super('VALIDATION_FAILED', 'Report range is not valid', fields, details);
  }
}

export interface ReportRange {
  from: string;
  to: string;
  /** Calendar months the range touches. */
  months: number;
}

export interface ResolveReportRangeInput {
  from?: string | undefined;
  to?: string | undefined;
  /** Today in the user's zone, `YYYY-MM-DD`. */
  today: string;
  maxMonths: number;
  defaultMonths: number;
}

function monthIndex(month: string): number {
  return Number.parseInt(month.slice(0, 4), 10) * 12 + Number.parseInt(month.slice(5, 7), 10) - 1;
}

function monthOfIndex(index: number): string {
  const year = (index - (index % 12)) / 12;
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** The `YYYY-MM` that is `count` months after (or, negative, before) the given one. */
export function addMonths(month: string, count: number): string {
  return monthOfIndex(monthIndex(month) + count);
}

/** Calendar months touched by `from` to `to` (both `YYYY-MM-DD`), both ends included. */
export function monthsBetween(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from) + 1;
}

/** Every `YYYY-MM` the range touches, in date order. */
export function monthsInRange(from: string, to: string): string[] {
  const first = from.slice(0, 7);
  const count = monthsBetween(from, to);
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) result.push(addMonths(first, i));
  return result;
}

function lastDayOfMonth(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const m = Number.parseInt(month.slice(5, 7), 10);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function resolveReportRange(input: ResolveReportRangeInput): ReportRange {
  const to = input.to ?? input.today;
  if (to > input.today) throw new ReportRangeError(['query.to']);
  const from = input.from ?? `${addMonths(to.slice(0, 7), 1 - input.defaultMonths)}-01`;
  if (from > to) throw new ReportRangeError(['query.from']);
  const months = monthsBetween(from, to);
  if (months > input.maxMonths) {
    throw new ReportRangeError(['query.from'], { maxMonths: String(input.maxMonths) });
  }
  return { from, to, months };
}

/**
 * One date per month, in order: the last day of the month, except the month of `today`, dated today.
 * A month after today's keeps its last day (the range resolver never produces one).
 */
export function netWorthPointDates(months: readonly string[], today: string): string[] {
  const currentMonth = today.slice(0, 7);
  return months.map((month) => (month === currentMonth ? today : lastDayOfMonth(month)));
}

function nextDay(date: string): string {
  const next = new Date(
    Date.UTC(
      Number.parseInt(date.slice(0, 4), 10),
      Number.parseInt(date.slice(5, 7), 10) - 1,
      Number.parseInt(date.slice(8, 10), 10) + 1,
    ),
  );
  return next.toISOString().slice(0, 10);
}

/** The first instant of a local day; if a clock change skips midnight, the first valid hour. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  for (let hour = 0; hour < 24; hour += 1) {
    const instant = zonedLocalToInstant(`${date}T${String(hour).padStart(2, '0')}:00`, timeZone);
    if (instant !== null) return instant;
  }
  throw new RangeError('No valid local time on the day');
}

/** Half-open `[from, before)` instants of the local days `from` to `to`, both included. */
export function localDayBounds(
  from: string,
  to: string,
  timeZone: string,
): { from: Date; before: Date } {
  return { from: startOfLocalDay(from, timeZone), before: startOfLocalDay(nextDay(to), timeZone) };
}
