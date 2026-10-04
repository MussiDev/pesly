import { AppError, LIST_MOVEMENTS_MAX_LIMIT, type MovementType } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Movement, MovementFilters } from '../domain/movement';
import { localDayRange } from './local-day-range';
import type { MovementRepository } from './ports/movement-repository';
import type { UserPreferences } from './ports/user-preferences';

export interface ListMovementsDependencies {
  movements: MovementRepository;
  preferences: UserPreferences;
}

/** `from` and `to` are local `YYYY-MM-DD` days, both inclusive. */
export interface ListMovementsOptions {
  limit: number;
  offset: number;
  accountId?: string;
  categoryId?: string;
  type?: MovementType;
  tag?: string;
  from?: string;
  to?: string;
}

export class ListMovements {
  constructor(private readonly deps: ListMovementsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    options: ListMovementsOptions,
  ): Promise<{ items: Movement[]; total: number }> {
    const { limit, offset, accountId, categoryId, type, tag, from, to } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_MOVEMENTS_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'limit or offset out of range');
    }
    // ISO days compare correctly as text.
    if (from !== undefined && to !== undefined && from > to) {
      throw new AppError('VALIDATION_FAILED', 'from is later than to');
    }

    const filters: MovementFilters = {
      ...(accountId === undefined ? {} : { accountId }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(type === undefined ? {} : { type }),
      ...(tag === undefined ? {} : { tag }),
    };
    if (from !== undefined || to !== undefined) {
      const { timeZone } = await this.deps.preferences.find(scope.userId);
      Object.assign(filters, localDayRange(from, to, timeZone));
    }
    return this.deps.movements.list(scope, { limit, offset, filters });
  }
}
