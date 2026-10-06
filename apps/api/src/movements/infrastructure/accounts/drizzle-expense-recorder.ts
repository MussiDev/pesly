import type {
  ExpenseRecorder,
  ExpenseToRecord,
} from '../../../credit-cards/application/ports/expense-recorder';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import { CreateMovement } from '../../application/create-movement';
import type { Clock } from '../../application/ports/clock';
import { RecordManualMovement } from '../../application/record-manual-movement';
import { DrizzleAccountLookup } from '../db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../db/drizzle-user-preferences';
import { SystemClock } from '../system-clock';

export interface ExpenseRecorderOptions {
  /** Manual creations per user per minute (default 60), shared with `POST /movements`. */
  writeLimit?: number;
  /** Defaults to the system clock; tests inject one to control the limiter window. */
  clock?: Clock;
}

class MovementsExpenseRecorder implements ExpenseRecorder {
  constructor(private readonly recordManualMovement: RecordManualMovement) {}

  async record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    const movement = await this.recordManualMovement.execute(scope, {
      type: 'expense',
      accountId: expense.accountId,
      categoryId: expense.categoryId,
      amount: expense.amount,
      occurredAt: expense.occurredAt,
      ...(expense.note === undefined ? {} : { note: expense.note }),
      rate: expense.rate,
    });
    return { id: movement.id, occurredAt: movement.occurredAt };
  }
}

/** The same use case and manual limiter bucket `POST /movements` uses, so every movement rule applies (spec D7). */
export function createExpenseRecorder(
  db: Database,
  logger: Logger,
  { writeLimit, clock = new SystemClock() }: ExpenseRecorderOptions = {},
): ExpenseRecorder {
  const createMovement = new CreateMovement({
    movements: new DrizzleMovementRepository(db),
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  return new MovementsExpenseRecorder(
    new RecordManualMovement(
      {
        createMovement,
        limiter: new DrizzleMovementWriteLimiter(db, clock),
        clock,
        // A failed refund only makes the limit stricter; it is logged without any request data.
        reportReleaseFailure: (error: unknown) => {
          logger.error({ err: error }, 'movement write limiter release failed');
        },
      },
      writeLimit,
    ),
  );
}
