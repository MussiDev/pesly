import type {
  AutomaticDebitRecorder,
  AutomaticDebitTransfer,
} from '../../../credit-cards/application/ports/automatic-debit-recorder';
import { ResourceNotFound, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import { CreateMovement } from '../../application/create-movement';
import { DuplicateMovementId } from '../../domain/errors';
import { DrizzleAccountLookup } from '../db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../db/drizzle-movement-repository';
import { DrizzleRateLookup } from '../db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../db/drizzle-user-preferences';
import { SystemClock } from '../system-clock';
import type { Clock } from '../../application/ports/clock';

export interface AutomaticDebitRecorderOptions {
  /** Defaults to the system clock; tests inject one. */
  clock?: Clock;
}

/**
 * Records the debit as a plain transfer through `CreateMovement` (every movement rule applies),
 * unmetered and keyed by the caller's id, so a retry after a crash returns the stored movement.
 */
export function createAutomaticDebitRecorder(
  db: Database,
  { clock = new SystemClock() }: AutomaticDebitRecorderOptions = {},
): AutomaticDebitRecorder {
  const movements = new DrizzleMovementRepository(db);
  const createMovement = new CreateMovement({
    movements,
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  return {
    async recordOnce(
      scope: AccessScope<'write'>,
      movementId: string,
      transfer: AutomaticDebitTransfer,
    ): Promise<{ id: string }> {
      try {
        const movement = await createMovement.execute(
          scope,
          {
            type: 'transfer',
            accountId: transfer.sourceAccountId,
            destinationAccountId: transfer.destinationAccountId,
            amount: transfer.amount,
            occurredAt: transfer.occurredAt,
          },
          movementId,
        );
        return { id: movement.id };
      } catch (error) {
        if (!(error instanceof DuplicateMovementId)) throw error;
        // A duplicate the owner cannot read belongs to someone else.
        const stored = await movements.findById(scope, movementId);
        if (stored === null) throw new ResourceNotFound();
        return { id: stored.id };
      }
    },
  };
}
