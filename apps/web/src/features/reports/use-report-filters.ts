'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  parseReportFilters,
  serializeReportFilters,
  type ReportFilterValues,
} from './report-filters-state';
import type { ReportKind } from './report-view';

export interface UseReportFiltersResult {
  /** The filters the address carries, each value already validated. */
  filters: ReportFilterValues;
  /** Replaces the address (no history entry per change) with the next filter set. */
  setFilters: (next: ReportFilterValues) => void;
  /** Drops the account and tag filters and keeps the range. */
  clearEntityFilters: () => void;
}

/** Holds the report filters in the page address; the address is the only copy. */
export function useReportFilters(kind: ReportKind): UseReportFiltersResult {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const urlKey = searchParams.toString();
  const filters = useMemo(
    () => parseReportFilters(new URLSearchParams(urlKey), kind),
    [urlKey, kind],
  );

  const setFilters = useCallback(
    (next: ReportFilterValues) => {
      const query = serializeReportFilters(next).toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [pathname, router],
  );

  const clearEntityFilters = useCallback(() => {
    setFilters({ from: filters.from, to: filters.to });
  }, [filters.from, filters.to, setFilters]);

  return { filters, setFilters, clearEntityFilters };
}
