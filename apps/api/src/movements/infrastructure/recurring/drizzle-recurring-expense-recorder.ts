import type { ExpenseRecorder } from '../../../recurring/application/ports/expense-recorder';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import {
  createExpenseRecorder,
  type ExpenseRecorderOptions,
} from '../accounts/drizzle-expense-recorder';

/**
 * Records a confirmed occurrence through `RecordManualMovement`: the same use case and manual
 * limiter bucket as `POST /movements`, so every movement rule applies unchanged. The recurring
 * port is the card port's shape, so the shared recorder satisfies it.
 */
export function createRecurringExpenseRecorder(
  db: Database,
  logger: Logger,
  options: ExpenseRecorderOptions = {},
): ExpenseRecorder {
  const recorder = createExpenseRecorder(db, logger, options);
  return { record: (scope, expense) => recorder.record(scope, expense) };
}
