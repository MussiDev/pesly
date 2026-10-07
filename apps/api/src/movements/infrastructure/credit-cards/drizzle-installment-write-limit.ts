import type {
  InstallmentWriteLimit,
  WriteUnit,
} from '../../../credit-cards/application/ports/installment-write-limit';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports/clock';
import type {
  MovementWriteLimiter,
  WritePolicy,
} from '../../application/ports/movement-write-limiter';
import {
  DEFAULT_MOVEMENT_WRITE_LIMIT,
  MOVEMENT_WRITE_WINDOW_SECONDS,
} from '../../application/record-manual-movement';
import { MovementWriteRateLimited } from '../../domain/errors';
import { DrizzleMovementWriteLimiter } from '../db/drizzle-movement-write-limiter';
import { SystemClock } from '../system-clock';

export interface InstallmentWriteLimitOptions {
  /** Creations per user per minute (default 60), shared with `POST /movements`. */
  writeLimit?: number;
  /** Defaults to the system clock; tests inject one to control the limiter window. */
  clock?: Clock;
}

/** The `manual` bucket of the movement write limiter, spent by installment purchases too (spec D7). */
class MovementsInstallmentWriteLimit implements InstallmentWriteLimit {
  constructor(
    private readonly limiter: MovementWriteLimiter,
    private readonly policy: WritePolicy,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async take(scope: AccessScope<'write'>): Promise<WriteUnit> {
    const ownerId = scope.userId;
    const reservation = await this.limiter.record(ownerId, this.policy);
    const release = async (): Promise<void> => {
      // A failing refund only makes the limiter stricter; it is logged without any request data.
      try {
        await this.limiter.release(ownerId, this.policy, reservation.windowStart);
      } catch (error) {
        this.logger.error({ err: error }, 'movement write limiter release failed');
      }
    };
    if (!reservation.allowed) {
      await release();
      const windowEnd = reservation.windowStart.getTime() + this.policy.windowSeconds * 1000;
      // Capped at the window length so a skewed clock cannot ask for a longer wait.
      const retryAfter = Math.min(
        this.policy.windowSeconds,
        Math.max(1, Math.ceil((windowEnd - this.clock.now().getTime()) / 1000)),
      );
      throw new MovementWriteRateLimited(retryAfter);
    }
    return { release };
  }
}

export function createInstallmentWriteLimit(
  db: Database,
  logger: Logger,
  {
    writeLimit = DEFAULT_MOVEMENT_WRITE_LIMIT,
    clock = new SystemClock(),
  }: InstallmentWriteLimitOptions = {},
): InstallmentWriteLimit {
  if (!Number.isInteger(writeLimit) || writeLimit < 1) {
    throw new RangeError('writeLimit must be an integer of at least 1');
  }
  return new MovementsInstallmentWriteLimit(
    new DrizzleMovementWriteLimiter(db, clock),
    { limit: writeLimit, windowSeconds: MOVEMENT_WRITE_WINDOW_SECONDS, bucket: 'manual' },
    clock,
    logger,
  );
}
