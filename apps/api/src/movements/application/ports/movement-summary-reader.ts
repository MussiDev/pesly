import type { AccountCurrency, CategorizedMovementType } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { MovementFilters } from '../../domain/movement';

/** The sum of the matching expenses or incomes of one category in one account currency. */
export interface MovementSummaryRow {
  categoryId: string | null;
  currency: AccountCurrency;
  type: CategorizedMovementType;
  amount: bigint;
  count: number;
}

export interface MovementSummaryReader {
  /** Only expenses and incomes in the scope that match every filter; no row for an empty group. */
  summarize(scope: AccessScope<'read'>, filters: MovementFilters): Promise<MovementSummaryRow[]>;
}
