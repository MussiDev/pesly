import { movementFilterShape } from '@pesly/shared';
import type { ListMovementsParams } from '@/lib/api-client';

/** The filters of the movement list; an absent key means "no filter on it". */
export interface MovementFilterValues {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  type?: 'expense' | 'income' | undefined;
  tag?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** The order the keys are written in the URL and in the list request. */
const KEYS = ['accountId', 'categoryId', 'from', 'to', 'type', 'tag'] as const;

/** Only the part of `URLSearchParams` this file reads, so Next's read-only copy fits too. */
interface ParamsReader {
  get(name: string): string | null;
}

/**
 * Reads the filters from URL search params. Each value is checked with the same shared schema the
 * API uses; a malformed one is ignored on its own and the others still apply.
 */
export function parseFilters(params: ParamsReader): MovementFilterValues {
  const filters: MovementFilterValues = {};
  for (const key of KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    const parsed = movementFilterShape[key].safeParse(raw);
    if (parsed.success && parsed.data !== undefined) {
      // One key at a time over a union of value types: the shape above guarantees the pairing.
      Object.assign(filters, { [key]: parsed.data });
    }
  }
  return filters;
}

export function serializeFilters(filters: MovementFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  return params;
}

export function hasActiveFilters(filters: MovementFilterValues): boolean {
  return KEYS.some((key) => filters[key] !== undefined);
}

/** Both days are `YYYY-MM-DD`, so the text order is the calendar order. */
export function isRangeInvalid({ from, to }: MovementFilterValues): boolean {
  return from !== undefined && to !== undefined && from > to;
}

/** The dates go as typed (local days); the server converts them in the user's time zone. */
export function filtersToListParams(filters: MovementFilterValues): ListMovementsParams {
  const params: ListMovementsParams = {};
  for (const key of KEYS) {
    const value = filters[key];
    if (value !== undefined) Object.assign(params, { [key]: value });
  }
  return params;
}
