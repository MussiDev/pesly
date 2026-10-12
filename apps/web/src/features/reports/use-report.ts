'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { isOffline } from '@/lib/connectivity';
import { signInHref } from '@/lib/return-path';
import { checkRange, type RangeCheck } from './range';
import { serializeReportFilters, type ReportFilterValues } from './report-filters-state';
import type { ReportKind } from './report-view';

export type ReportRangeProblem =
  | { reason: 'from_after_to' }
  | { reason: 'to_in_future' }
  | { reason: 'too_long'; maxMonths: number }
  | { reason: 'server' };

export type ReportState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; retrying: boolean }
  | { status: 'offline' }
  | { status: 'filterGone' }
  | ({ status: 'badRange'; field: 'from' | 'to' } & ReportRangeProblem);

export interface UseReportOptions<T> {
  kind: ReportKind;
  filters: ReportFilterValues;
  /** Sends the request for the current filters; called once per distinct key and per retry. */
  load: () => Promise<ApiResult<T>>;
  /** The user's today; without it only a range with both ends is checked locally. */
  today?: string | undefined;
}

export interface UseReportResult<T> {
  state: ReportState<T>;
  retry: () => void;
}

/** The local range check; without today an open end cannot be judged, so the server decides. */
export function rangeCheckFor(
  kind: ReportKind,
  filters: Pick<ReportFilterValues, 'from' | 'to'>,
  today: string | undefined,
): RangeCheck {
  const reference = today ?? filters.to;
  if (reference === undefined) return { ok: true };
  return checkRange({ from: filters.from, to: filters.to, today: reference, kind });
}

/** Which date field a local range problem is shown on. */
function fieldOf(check: Exclude<RangeCheck, { ok: true }>): 'from' | 'to' {
  return check.reason === 'too_long' ? 'from' : 'to';
}

interface Stored<T> {
  key: string;
  state: ReportState<T>;
}

/**
 * The one request hook of the three report screens. One request per distinct filter key and per
 * retry; the answer of a request whose key was replaced is never shown. Nothing is stored: the
 * earlier answer is dropped as soon as the key changes, on failure, offline and sign-out.
 */
export function useReport<T>({
  kind,
  filters,
  load,
  today,
}: UseReportOptions<T>): UseReportResult<T> {
  const router = useRouter();
  const pathname = usePathname();
  const key = `${kind}?${serializeReportFilters(filters).toString()}`;
  const check = rangeCheckFor(kind, filters, today);
  const [stored, setStored] = useState<Stored<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  const inFlight = useRef(false);
  const pathRef = useRef(pathname);

  useEffect(() => {
    loadRef.current = load;
    pathRef.current = pathname;
  });

  const rangeOk = check.ok;
  useEffect(() => {
    if (!rangeOk) return;
    let active = true;
    if (isOffline()) {
      inFlight.current = false;
      setStored({ key, state: { status: 'offline' } });
      return;
    }
    // A retry of a failure keeps the failure on screen (retrying) until the answer arrives.
    setStored((current) =>
      current?.key === key && current.state.status === 'failed'
        ? current
        : { key, state: { status: 'loading' } },
    );
    inFlight.current = true;
    void loadRef.current().then((result) => {
      if (!active) return;
      inFlight.current = false;
      if (result.ok) {
        setStored({ key, state: { status: 'ready', data: result.data } });
        return;
      }
      switch (result.code) {
        case 'UNAUTHENTICATED':
          setStored({ key, state: { status: 'loading' } });
          router.replace(signInHref(pathRef.current));
          return;
        case 'NOT_FOUND':
          setStored({ key, state: { status: 'filterGone' } });
          return;
        case 'NETWORK':
          setStored({
            key,
            state: isOffline() ? { status: 'offline' } : { status: 'failed', retrying: false },
          });
          return;
        default: {
          const field = result.fields?.includes('query.to')
            ? 'to'
            : result.fields?.includes('query.from')
              ? 'from'
              : undefined;
          setStored({
            key,
            state:
              result.code === 'VALIDATION_FAILED' && field !== undefined
                ? { status: 'badRange', field, reason: 'server' }
                : { status: 'failed', retrying: false },
          });
        }
      }
    });
    return () => {
      active = false;
      inFlight.current = false;
    };
  }, [key, attempt, rangeOk, router]);

  const retry = useCallback(() => {
    if (inFlight.current) return;
    setStored((current) =>
      current?.state.status === 'failed'
        ? { ...current, state: { status: 'failed', retrying: true } }
        : current,
    );
    setAttempt((value) => value + 1);
  }, []);

  if (!check.ok) {
    const problem: ReportRangeProblem =
      check.reason === 'too_long'
        ? { reason: 'too_long', maxMonths: check.maxMonths }
        : { reason: check.reason };
    return { state: { status: 'badRange', field: fieldOf(check), ...problem }, retry };
  }
  // An answer kept for another key is not shown, not even for one render.
  const state: ReportState<T> = stored?.key === key ? stored.state : { status: 'loading' };
  return { state, retry };
}
