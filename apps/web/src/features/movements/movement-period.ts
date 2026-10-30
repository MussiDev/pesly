import { addMonths } from '@pesly/shared';
import type { MovementFilterValues } from './movement-filters-state';

/** The quick ranges of the summary; `custom` is any other pair of dates typed in the filters. */
export const MOVEMENT_PERIODS = ['all', 'thisMonth', 'lastMonth'] as const;
export type MovementPeriod = (typeof MOVEMENT_PERIODS)[number] | 'custom';

/** The last day of a `YYYY-MM` month; UTC arithmetic on a date with no time of day has no DST. */
function lastDayOf(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthIndex = Number.parseInt(month.slice(5, 7), 10);
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

/** The `from` and `to` filters of a quick range; `today` is the user's local `YYYY-MM-DD`. */
export function periodRange(
  period: (typeof MOVEMENT_PERIODS)[number],
  today: string,
): Pick<MovementFilterValues, 'from' | 'to'> {
  const month = today.slice(0, 7);
  switch (period) {
    case 'all':
      return { from: undefined, to: undefined };
    case 'thisMonth':
      return { from: `${month}-01`, to: lastDayOf(month) };
    case 'lastMonth': {
      const previous = addMonths(month, -1);
      return { from: `${previous}-01`, to: lastDayOf(previous) };
    }
  }
}

/** Which quick range the dates of `filters` are, or `custom` when they are none of them. */
export function periodOf(filters: MovementFilterValues, today: string): MovementPeriod {
  for (const period of MOVEMENT_PERIODS) {
    const range = periodRange(period, today);
    if (range.from === filters.from && range.to === filters.to) return period;
  }
  return 'custom';
}
