import type { AccessScope } from '../../../shared/access';

/** One threshold of one budget that the month's spending has reached. */
export interface AlertCrossing {
  budgetId: string;
  budgetName: string;
  /** The first day of the month, `YYYY-MM-01`. */
  month: string;
  threshold: number;
}

export interface BudgetAlertStore {
  /**
   * Marks every crossing that has no mark yet and publishes one notice for each mark it created,
   * all in one transaction. Returns how many notices were created.
   */
  publish(scope: AccessScope, crossings: readonly AlertCrossing[]): Promise<number>;
}
