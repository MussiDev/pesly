import type { AccessScope } from '../../shared/access';
import type { Database } from '../../shared/db/client';
import type {
  ExpenseSavedEvent,
  ExpenseSavedListener,
} from '../../movements/application/ports/expense-saved-listener';
import { EvaluateBudgetAlerts } from '../application/evaluate-budget-alerts';
import type { Clock } from '../application/ports/clock';
import { SystemClock } from './clock/system-clock';
import { DrizzleBudgetAlertStore, type RenderAlertText } from './db/drizzle-budget-alert-store';
import { DrizzleBudgetVersionReader } from './db/drizzle-budget-version-reader';
import { DrizzleSpendingReader } from './db/drizzle-spending-reader';
import { DrizzleUserTimeZone } from './db/drizzle-user-time-zone';

export interface BudgetAlertListenerOptions {
  renderText: RenderAlertText;
  clock?: Clock;
}

/** The budgets side of the movements port: evaluates the budgets of the saved expense's category. */
export function createBudgetAlertListener(
  db: Database,
  options: BudgetAlertListenerOptions,
): ExpenseSavedListener {
  const evaluate = new EvaluateBudgetAlerts({
    clock: options.clock ?? new SystemClock(),
    timeZones: new DrizzleUserTimeZone(db),
    versions: new DrizzleBudgetVersionReader(db),
    spending: new DrizzleSpendingReader(db),
    alerts: new DrizzleBudgetAlertStore(db, options.renderText),
  });
  return {
    async afterExpenseSaved(scope: AccessScope<'write'>, event: ExpenseSavedEvent): Promise<void> {
      await evaluate.execute(scope, event);
    },
  };
}
