import { netWorthQuerySchema, reportFlowQuerySchema } from '@pesly/shared';
import type { ReportFlowParams } from '@/lib/api-client';
import type { ReportKind } from './report-view';

/** The filters of a report; an absent key means "no filter on it". */
export interface ReportFilterValues {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  tag?: string | undefined;
}

/** The order the keys are written in the address and in the request. */
const KEYS = ['from', 'to', 'accountId', 'tag'] as const;

/** Only the part of `URLSearchParams` this file reads, so Next's read-only copy fits too. */
interface ParamsReader {
  getAll(name: string): string[];
}

/**
 * Reads the filters from the address. Each value is checked with the shared query definition of the
 * report; a malformed or repeated one is ignored on its own and the others still apply. Net worth has
 * no account or tag filter, so those keys are never read for it.
 */
export function parseReportFilters(params: ParamsReader, kind: ReportKind): ReportFilterValues {
  const shape = kind === 'netWorth' ? netWorthQuerySchema.shape : reportFlowQuerySchema.shape;
  const filters: ReportFilterValues = {};
  for (const key of KEYS) {
    const field = (
      shape as Partial<
        Record<
          (typeof KEYS)[number],
          { safeParse(value: unknown): { success: boolean; data?: unknown } }
        >
      >
    )[key];
    if (field === undefined) continue;
    const values = params.getAll(key);
    if (values.length !== 1) continue;
    const parsed = field.safeParse(values[0]);
    if (parsed.success && typeof parsed.data === 'string') {
      Object.assign(filters, { [key]: parsed.data });
    }
  }
  return filters;
}

export function serializeReportFilters(filters: ReportFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  return params;
}

/** An account or tag filter is active (the filtered notice depends on it). */
export function hasEntityFilter(filters: ReportFilterValues): boolean {
  return filters.accountId !== undefined || filters.tag !== undefined;
}

/** The request query: only the defined keys; the dates go as typed, the server resolves the range. */
export function toReportQuery(filters: ReportFilterValues): ReportFlowParams {
  const query: ReportFlowParams = {};
  for (const key of KEYS) {
    const value = filters[key];
    if (value !== undefined) Object.assign(query, { [key]: value });
  }
  return query;
}
