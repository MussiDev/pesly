import type {
  ExpenseRecorder,
  ExpenseToRecord,
} from '../../../credit-cards/application/ports/expense-recorder';
import { ResourceNotFound, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import { CreateMovement, type CreateMovementInput } from '../../application/create-movement';
import type { Clock } from '../../application/ports/clock';
import type { MovementRepository } from '../../application/ports/movement-repository';
import { DuplicateMovementId } from '../../domain/errors';
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

function toInput(expense: ExpenseToRecord): CreateMovementInput {
  return {
    type: 'expense',
    accountId: expense.accountId,
    categoryId: expense.categoryId,
    amount: expense.amount,
    occurredAt: expense.occurredAt,
    ...(expense.note === undefined ? {} : { note: expense.note }),
    rate: expense.rate,
  };
}

export class MovementsExpenseRecorder implements ExpenseRecorder {
  constructor(
    private readonly recordManualMovement: RecordManualMovement,
    private readonly createMovement: CreateMovement,
    private readonly movements: MovementRepository,
  ) {}

  async record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    const movement = await this.recordManualMovement.execute(scope, toInput(expense));
    return { id: movement.id, occurredAt: movement.occurredAt };
  }

  async recordUnmetered(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    const movement = await this.createMovement.execute(scope, toInput(expense));
    return { id: movement.id, occurredAt: movement.occurredAt };
  }

  /**
   * Unmetered (the job must not spend the manual write budget) and idempotent by `id`: a repeat
   * returns the stored movement. A duplicate the owner cannot read belongs to someone else.
   */
  async recordUnmeteredWithId(
    scope: AccessScope<'write'>,
    id: string,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    try {
      const movement = await this.createMovement.execute(scope, toInput(expense), id);
      return { id: movement.id, occurredAt: movement.occurredAt };
    } catch (error) {
      if (!(error instanceof DuplicateMovementId)) throw error;
      const stored = await this.movements.findById(scope, id);
      if (stored === null) throw new ResourceNotFound();
      return { id: stored.id, occurredAt: stored.occurredAt };
    }
  }
}

function buildRecorder(
  db: Database,
  logger: Logger,
  { writeLimit, clock = new SystemClock() }: ExpenseRecorderOptions,
): MovementsExpenseRecorder {
  const movements = new DrizzleMovementRepository(db);
  const createMovement = new CreateMovement({
    movements,
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
    createMovement,
    movements,
  );
}

/** The recurring module's recorder: the same wiring, with the id-keyed unmetered path exposed. */
export function createMovementsExpenseRecorder(
  db: Database,
  logger: Logger,
  options: ExpenseRecorderOptions = {},
): MovementsExpenseRecorder {
  return buildRecorder(db, logger, options);
}

/** The same use case and manual limiter bucket `POST /movements` uses, so every movement rule applies (spec D7). */
export function createExpenseRecorder(
  db: Database,
  logger: Logger,
  options: ExpenseRecorderOptions = {},
): ExpenseRecorder {
  return buildRecorder(db, logger, options);
}
