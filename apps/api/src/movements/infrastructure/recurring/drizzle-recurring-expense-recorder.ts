import type { ExpenseRecorder } from '../../../recurring/application/ports/expense-recorder';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import {
  createMovementsExpenseRecorder,
  type ExpenseRecorderOptions,
} from '../accounts/drizzle-expense-recorder';

/**
 * `record` goes through `RecordManualMovement` (the same use case and manual limiter bucket as
 * `POST /movements`); `recordOnce` is the job's unmetered path keyed by the occurrence id, so
 * every movement rule applies unchanged.
 */
export function createRecurringExpenseRecorder(
  db: Database,
  logger: Logger,
  options: ExpenseRecorderOptions = {},
): ExpenseRecorder {
  const recorder = createMovementsExpenseRecorder(db, logger, options);
  return {
    record: (scope, expense) => recorder.record(scope, expense),
    recordOnce: (scope, id, expense) => recorder.recordUnmeteredWithId(scope, id, expense),
  };
}
