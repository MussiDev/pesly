import { AppError, LIST_MOVEMENTS_MAX_LIMIT, type MovementGroupLink } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import { toMovementFilters, type MovementFilterOptions } from './movement-filter-options';
import type { MovementRepository } from './ports/movement-repository';
import type { UserPreferences } from './ports/user-preferences';

export interface ListMovementsDependencies {
  movements: MovementRepository;
  preferences: UserPreferences;
}

/** `from` and `to` are local `YYYY-MM-DD` days, both inclusive. */
export interface ListMovementsOptions extends MovementFilterOptions {
  limit: number;
  offset: number;
}

export class ListMovements {
  constructor(private readonly deps: ListMovementsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    options: ListMovementsOptions,
  ): Promise<{
    items: Movement[];
    total: number;
    groupLinks: Record<string, MovementGroupLink>;
  }> {
    const { limit, offset, ...filterOptions } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_MOVEMENTS_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'limit or offset out of range');
    }
    const filters = await toMovementFilters(scope, filterOptions, this.deps.preferences);
    const page = await this.deps.movements.list(scope, { limit, offset, filters });
    const groupLinks = await this.deps.movements.groupLinks(
      scope,
      page.items.map((item) => item.id),
    );
    return { ...page, groupLinks };
  }
}
