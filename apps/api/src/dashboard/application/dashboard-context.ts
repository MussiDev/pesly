import { todayInTimeZone } from '@pesly/shared';
import type { Clock, ReportPreferences, ReportPreferencesReader } from '../../reports';
import type { AccessScope } from '../../shared/access';

export interface DashboardContextDependencies {
  clock: Clock;
  preferences: ReportPreferencesReader;
}

export interface DashboardContext {
  preferences: ReportPreferences;
  /** Today in the user zone, `YYYY-MM-DD`. */
  today: string;
  /** The current local month, `YYYY-MM`. */
  month: string;
  /** The first day of the current local month, `YYYY-MM-01`. */
  monthStart: string;
  userId: string;
}

/** The one preferences read of the request; every section builder works from its result. */
export async function prepareDashboard(
  deps: DashboardContextDependencies,
  scope: AccessScope,
): Promise<DashboardContext> {
  const preferences = await deps.preferences.preferencesOf(scope.userId);
  const today = todayInTimeZone(deps.clock.now(), preferences.timeZone);
  const month = today.slice(0, 7);
  return { preferences, today, month, monthStart: `${month}-01`, userId: scope.userId };
}
