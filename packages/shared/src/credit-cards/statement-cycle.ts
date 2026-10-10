/**
 * Statement cycle arithmetic (DISC-001-10a FR-03, FR-04, FR-07). Periods are `YYYY-MM` and dates
 * `YYYY-MM-DD` calendar dates; everything is integer year, month and day arithmetic, so no time
 * zone is involved. "Today" is computed by the caller in the user's time zone.
 */

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface StatementDates {
  closingDate: string;
  dueDate: string;
}

interface YearMonth {
  year: number;
  month: number;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const formatPeriod = ({ year, month }: YearMonth): string => `${pad(year, 4)}-${pad(month, 2)}`;

function parsePeriod(period: string): YearMonth {
  const match = PERIOD_PATTERN.exec(period);
  if (match === null) throw new RangeError(`Invalid period: ${period}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseDate(date: string): YearMonth & { day: number } {
  if (!isCalendarDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const [year = '', month = '', day = ''] = date.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function checkDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`Invalid day of the month: ${day}`);
  }
}

function shift({ year, month }: YearMonth, months: number): YearMonth {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day in that month, or the month's last day when the month is shorter (FR-04). */
function clampedDate({ year, month }: YearMonth, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(Math.min(day, daysInMonth(year, month)), 2)}`;
}

/** True for a `YYYY-MM-DD` string naming a date that exists (2027-02-29 does not). */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * The closing date is the closing day of the period's month; the due date is the first due day
 * after it: in the same month when that day comes later, otherwise in the next month (FR-03).
 */
export function statementDatesFor(
  period: string,
  closingDay: number,
  dueDay: number,
): StatementDates {
  const month = parsePeriod(period);
  checkDay(closingDay);
  checkDay(dueDay);
  const closingDate = clampedDate(month, closingDay);
  const sameMonthDue = clampedDate(month, dueDay);
  const dueDate = sameMonthDue > closingDate ? sameMonthDue : clampedDate(shift(month, 1), dueDay);
  return { closingDate, dueDate };
}

export function nextPeriod(period: string): string {
  return formatPeriod(shift(parsePeriod(period), 1));
}

export function previousPeriod(period: string): string {
  return formatPeriod(shift(parsePeriod(period), -1));
}

/** The cycle that is open today: this month's when its closing date has not passed, else the next. */
export function firstOpenPeriod(today: string, closingDay: number): string {
  const { year, month } = parseDate(today);
  checkDay(closingDay);
  const current = { year, month };
  return formatPeriod(clampedDate(current, closingDay) >= today ? current : shift(current, 1));
}

/** A statement is closed once its closing date has ended: today is after it (FR-07). */
export function isStatementClosed(closingDate: string, today: string): boolean {
  return closingDate < today;
}
