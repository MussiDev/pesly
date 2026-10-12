import { todayInTimeZone } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { ExpenseSavedEvent } from '../../movements/application/ports/expense-saved-listener';
import { crossedThresholds, monthStartDate } from '../domain/alerts';
import { monthOf } from '../domain/month';
import { computeSpending } from './compute-spending';
import type { SpendingDependencies } from './dependencies';
import type { AlertCrossing, BudgetAlertStore } from './ports/budget-alert-store';

export interface AlertDependencies extends SpendingDependencies {
  alerts: BudgetAlertStore;
}

/**
 * State-based: every threshold at or below the percentage used that has no mark is published,
 * whichever expense got it there, so a crossing missed once is caught by the next expense.
 * Errors propagate; the movements hook is the one place that handles them.
 */
export class EvaluateBudgetAlerts {
  constructor(private readonly deps: AlertDependencies) {}

  async execute(scope: AccessScope, event: ExpenseSavedEvent): Promise<void> {
    const timeZone = await this.deps.timeZones.timeZoneOf(scope.userId);
    const eventMonth = monthOf(todayInTimeZone(event.occurredAt, timeZone));
    const currentMonth = monthOf(todayInTimeZone(this.deps.clock.now(), timeZone));
    if (eventMonth !== currentMonth) return;

    const { month, budgets } = await computeSpending(
      this.deps,
      scope,
      currentMonth,
      undefined,
      event.categoryId,
    );
    const crossings: AlertCrossing[] = budgets.flatMap((budget) =>
      crossedThresholds(budget.thresholds, budget.percentUsed).map((threshold) => ({
        budgetId: budget.budgetId,
        budgetName: budget.name,
        month: monthStartDate(month),
        threshold,
      })),
    );
    if (crossings.length > 0) await this.deps.alerts.publish(scope, crossings);
  }
}
