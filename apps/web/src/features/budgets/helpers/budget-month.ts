import { budgetSpendingMonthSchema } from '@pesly/shared';

/** The API's lower bound for a spending month. */
const FLOOR_YEAR = 1971;

/** `current` is the month the no-month call answered; `selected` is the one on screen. */
export interface MonthState {
  current: string;
  selected: string;
}

export function isValidMonth(text: string): boolean {
  return budgetSpendingMonthSchema.safeParse(text).success;
}

function parts(month: string): { year: number; monthNumber: number } {
  const [year = '', monthNumber = ''] = month.split('-');
  return { year: Number.parseInt(year, 10), monthNumber: Number.parseInt(monthNumber, 10) };
}

function format(year: number, monthNumber: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}`;
}

/** `null` at the floor (1971-01). */
export function previousMonth(month: string): string | null {
  const { year, monthNumber } = parts(month);
  if (year === FLOOR_YEAR && monthNumber === 1) return null;
  return monthNumber === 1 ? format(year - 1, 12) : format(year, monthNumber - 1);
}

export function canGoPrevious(month: string): boolean {
  return previousMonth(month) !== null;
}

/** `YYYY-MM` strings compare in calendar order as text. */
export function isMonthAfter(month: string, other: string): boolean {
  return month > other;
}

export function initialMonthState(current: string): MonthState {
  return { current, selected: current };
}

export function selectMonth(state: MonthState, month: string): MonthState {
  return { current: state.current, selected: month };
}

/** `null` while the current month is shown: there is nothing after it. */
export function nextMonth(state: MonthState): string | null {
  if (!isMonthAfter(state.current, state.selected)) return null;
  const { year, monthNumber } = parts(state.selected);
  return monthNumber === 12 ? format(year + 1, 1) : format(year, monthNumber + 1);
}

export function canGoNext(state: MonthState): boolean {
  return nextMonth(state) !== null;
}

/** The month to send: none for the current month, so the API answers in the user's time zone. */
export function queryMonth(state: MonthState): string | undefined {
  return state.selected === state.current ? undefined : state.selected;
}
