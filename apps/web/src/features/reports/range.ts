import { REPORT_MAX_MONTHS, addMonths, monthsBetween } from '@pesly/shared';
import type { ReportKind } from './report-view';

export type RangePreset = 'thisMonth' | 'last3' | 'last12' | 'last24';

export interface RangeDates {
  from?: string | undefined;
  to?: string | undefined;
}

/** How many months back (counting the current one) each preset reaches. */
const PRESET_MONTHS: Record<RangePreset, number> = {
  thisMonth: 1,
  last3: 3,
  last12: 12,
  last24: 24,
};

const MAX_MONTHS: Record<ReportKind, number> = {
  categories: REPORT_MAX_MONTHS.expensesByCategory,
  incomeExpenses: REPORT_MAX_MONTHS.incomeExpenses,
  netWorth: REPORT_MAX_MONTHS.netWorth,
};

/** How many months a range of the report may cover. */
export function maxMonthsFor(kind: ReportKind): number {
  return MAX_MONTHS[kind];
}

/** Income against expenses stops at 12 months, so it has no last-24 preset. */
export function presetsFor(kind: ReportKind): RangePreset[] {
  const all: RangePreset[] = ['thisMonth', 'last3', 'last12', 'last24'];
  return all.filter((preset) => PRESET_MONTHS[preset] <= MAX_MONTHS[kind]);
}

/** The first day of the month `count - 1` months before today's, up to today. */
export function rangeOfPreset(preset: RangePreset, today: string): { from: string; to: string } {
  const month = addMonths(today.slice(0, 7), 1 - PRESET_MONTHS[preset]);
  return { from: `${month}-01`, to: today };
}

/** What the API applies when the address carries no dates. */
function defaultPreset(kind: ReportKind): RangePreset {
  return kind === 'categories' ? 'thisMonth' : 'last12';
}

/** The preset the dates stand for, the default one with no dates, or `custom`. */
export function activePreset(
  filters: RangeDates,
  today: string,
  kind: ReportKind,
): RangePreset | 'custom' {
  if (filters.from === undefined && filters.to === undefined) return defaultPreset(kind);
  if (filters.from === undefined || filters.to === undefined) return 'custom';
  const match = presetsFor(kind).find((preset) => {
    const range = rangeOfPreset(preset, today);
    return range.from === filters.from && range.to === filters.to;
  });
  return match ?? 'custom';
}

export type RangeCheck =
  | { ok: true }
  | { ok: false; reason: 'to_in_future' }
  | { ok: false; reason: 'from_after_to' }
  | { ok: false; reason: 'too_long'; maxMonths: number };

/** `YYYY-MM-DD` text compares in calendar order. A missing end is today; a missing start is the API default. */
export function checkRange(input: RangeDates & { today: string; kind: ReportKind }): RangeCheck {
  // The API answers 400 on an end date after today (PRD Decision Log 1), so it is not sent.
  if (input.to !== undefined && input.to > input.today)
    return { ok: false, reason: 'to_in_future' };
  const to = input.to ?? input.today;
  if (input.from === undefined) return { ok: true };
  if (input.from > to) return { ok: false, reason: 'from_after_to' };
  const maxMonths = MAX_MONTHS[input.kind];
  if (monthsBetween(input.from, to) > maxMonths)
    return { ok: false, reason: 'too_long', maxMonths };
  return { ok: true };
}
