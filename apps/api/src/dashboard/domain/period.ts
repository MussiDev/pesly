import { addMonths, daysInMonth } from '@pesly/shared';

export interface MonthPeriods {
  /** The current local month, `YYYY-MM`. */
  month: string;
  first: string;
  /** The last day of the current month. */
  monthEnd: string;
  previousMonth: string;
  previousFrom: string;
  /** Today's day of month in the previous month, clamped to its last day. */
  previousTo: string;
  /** The last day of the previous month; installments carry the whole month (D5). */
  previousEnd: string;
  /** The three complete months before the current one, oldest first. */
  history: string[];
}

function lastDayOf(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const number = Number.parseInt(month.slice(5, 7), 10);
  return `${month}-${String(daysInMonth(year, number)).padStart(2, '0')}`;
}

export function monthPeriods(today: string): MonthPeriods {
  const month = today.slice(0, 7);
  const previousMonth = addMonths(month, -1);
  const day = Number.parseInt(today.slice(8, 10), 10);
  const previousLast = Number.parseInt(lastDayOf(previousMonth).slice(8, 10), 10);
  return {
    month,
    first: `${month}-01`,
    monthEnd: lastDayOf(month),
    previousMonth,
    previousFrom: `${previousMonth}-01`,
    previousTo: `${previousMonth}-${String(Math.min(day, previousLast)).padStart(2, '0')}`,
    previousEnd: lastDayOf(previousMonth),
    history: [addMonths(month, -3), addMonths(month, -2), previousMonth],
  };
}
