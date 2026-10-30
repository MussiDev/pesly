import type { AccessScope } from '../../shared/access';
import { toMovementFilters, type MovementFilterOptions } from './movement-filter-options';
import type { MovementSummaryReader, MovementSummaryRow } from './ports/movement-summary-reader';
import type { UserPreferences } from './ports/user-preferences';

export interface SummarizeMovementsDependencies {
  summaries: MovementSummaryReader;
  preferences: UserPreferences;
}

/** The totals of the movements the list shows for the same filters, by category and currency. */
export class SummarizeMovements {
  constructor(private readonly deps: SummarizeMovementsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    options: MovementFilterOptions,
  ): Promise<MovementSummaryRow[]> {
    const filters = await toMovementFilters(scope, options, this.deps.preferences);
    return this.deps.summaries.summarize(scope, filters);
  }
}
