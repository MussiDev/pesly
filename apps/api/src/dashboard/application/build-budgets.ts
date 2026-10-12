import {
  computeSpending,
  type BudgetVersionReader,
  type SpendingReader,
  type Clock,
} from '../../budgets';
import type { AccessScope } from '../../shared/access';
import { topBudgets, type BudgetHighlight } from '../domain/budget-highlights';
import { ContextTimeZones } from './context-time-zones';
import type { DashboardContext } from './dashboard-context';

export interface BuildBudgetsDependencies {
  versions: BudgetVersionReader;
  spending: SpendingReader;
  clock: Clock;
}

/**
 * The budgets in force this month, reduced to the three closest to their limit. The zone comes
 * from the request context, so the budgets module does not read it again. Errors are not caught.
 */
export async function buildBudgets(
  deps: BuildBudgetsDependencies,
  scope: AccessScope,
  context: DashboardContext,
): Promise<BudgetHighlight[]> {
  const { budgets } = await computeSpending(
    {
      versions: deps.versions,
      spending: deps.spending,
      clock: deps.clock,
      timeZones: new ContextTimeZones(context.userId, context.preferences.timeZone),
    },
    scope,
    undefined,
  );
  return topBudgets(budgets);
}
