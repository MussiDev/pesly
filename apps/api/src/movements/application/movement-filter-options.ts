import { AppError, type MovementType } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { MovementFilters } from '../domain/movement';
import { localDayRange } from './local-day-range';
import type { UserPreferences } from './ports/user-preferences';

/** The filters of the movement list as the query gives them; `from` and `to` are local days. */
export interface MovementFilterOptions {
  accountId?: string;
  categoryId?: string;
  type?: MovementType;
  tag?: string;
  /** The query text: only `"true"` hides adjustments. */
  hideAdjustments?: 'true' | 'false';
  from?: string;
  to?: string;
}

/** Turns the query filters into repository filters, with the local days as instants. */
export async function toMovementFilters(
  scope: AccessScope,
  options: MovementFilterOptions,
  preferences: UserPreferences,
): Promise<MovementFilters> {
  const { accountId, categoryId, type, tag, hideAdjustments, from, to } = options;
  // ISO days compare correctly as text.
  if (from !== undefined && to !== undefined && from > to) {
    throw new AppError('VALIDATION_FAILED', 'from is later than to');
  }
  const filters: MovementFilters = {
    ...(accountId === undefined ? {} : { accountId }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(type === undefined ? {} : { type }),
    ...(tag === undefined ? {} : { tag }),
    ...(hideAdjustments === 'true' ? { hideAdjustments: true } : {}),
  };
  if (from !== undefined || to !== undefined) {
    const { timeZone } = await preferences.find(scope.userId);
    Object.assign(filters, localDayRange(from, to, timeZone));
  }
  return filters;
}
