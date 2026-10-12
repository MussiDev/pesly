import {
  localDayBounds,
  resolveReportRange,
  todayInTimeZone,
  type NetWorthQuery,
  type ReportFlowQuery,
  type ReportRange,
} from '@pesly/shared';
import { ResourceNotFound, type AccessScope } from '../../shared/access';
import type { Clock } from './ports/clock';
import type { ReportFilterReader } from './ports/report-filter-reader';
import type { ReportPreferences, ReportPreferencesReader } from './ports/report-preferences';

export interface PrepareReportDependencies {
  clock: Clock;
  preferences: ReportPreferencesReader;
  filters: ReportFilterReader;
}

export interface ReportSpec {
  maxMonths: number;
  defaultMonths: number;
}

export interface ReportContext {
  preferences: ReportPreferences;
  /** Today in the user's zone, `YYYY-MM-DD`. */
  today: string;
  range: ReportRange;
  /** Half-open `[from, before)` instants of the local days of the range. */
  bounds: { from: Date; before: Date };
  accountId?: string;
  tag?: string;
}

/** The shared first step of every report: preferences, range and ownership of the filters. */
export async function prepareReport(
  deps: PrepareReportDependencies,
  scope: AccessScope,
  query: ReportFlowQuery | NetWorthQuery,
  spec: ReportSpec,
): Promise<ReportContext> {
  const preferences = await deps.preferences.preferencesOf(scope.userId);
  const today = todayInTimeZone(deps.clock.now(), preferences.timeZone);
  const range = resolveReportRange({
    from: query.from,
    to: query.to,
    today,
    maxMonths: spec.maxMonths,
    defaultMonths: spec.defaultMonths,
  });
  const bounds = localDayBounds(range.from, range.to, preferences.timeZone);
  const context: ReportContext = { preferences, today, range, bounds };

  const accountId = 'accountId' in query ? query.accountId : undefined;
  const tag = 'tag' in query ? query.tag : undefined;
  if (accountId !== undefined) {
    if (!(await deps.filters.ownsAccount(scope, accountId))) throw new ResourceNotFound();
    context.accountId = accountId;
  }
  if (tag !== undefined) {
    if (!(await deps.filters.ownsTag(scope, tag))) throw new ResourceNotFound();
    context.tag = tag;
  }
  return context;
}
