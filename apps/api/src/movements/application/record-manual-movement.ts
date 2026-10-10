import type { AccessScope } from '../../shared/access';
import { MovementWriteRateLimited } from '../domain/errors';
import type { Movement } from '../domain/movement';
import type { CreateMovement, CreateMovementInput } from './create-movement';
import type { Clock } from './ports/clock';
import type { MovementWriteLimiter, WritePolicy } from './ports/movement-write-limiter';

export const MOVEMENT_WRITE_WINDOW_SECONDS = 60;
export const DEFAULT_MOVEMENT_WRITE_LIMIT = 60;

export interface RecordManualMovementDependencies {
  createMovement: CreateMovement;
  limiter: MovementWriteLimiter;
  clock: Clock;
  /** Called when the refund of a unit fails; the caller still gets the original outcome. */
  reportReleaseFailure: (error: unknown) => void;
}

/** What the route calls: `CreateMovement` behind the per-owner creation limit. */
export class RecordManualMovement {
  private readonly policy: WritePolicy;

  constructor(
    private readonly deps: RecordManualMovementDependencies,
    writeLimit: number = DEFAULT_MOVEMENT_WRITE_LIMIT,
  ) {
    if (!Number.isInteger(writeLimit) || writeLimit < 1) {
      throw new RangeError('writeLimit must be an integer of at least 1');
    }
    this.policy = {
      limit: writeLimit,
      windowSeconds: MOVEMENT_WRITE_WINDOW_SECONDS,
      bucket: 'manual',
    };
  }

  async execute(scope: AccessScope<'write'>, input: CreateMovementInput): Promise<Movement> {
    const ownerId = scope.userId;
    const reservation = await this.deps.limiter.record(ownerId, this.policy);

    // Only a saved movement keeps its unit; every other way out refunds it.
    let keepUnit = false;
    try {
      if (!reservation.allowed) {
        const windowEnd = reservation.windowStart.getTime() + this.policy.windowSeconds * 1000;
        // Capped at the window length so a skewed clock cannot ask for a longer wait.
        const retryAfter = Math.min(
          this.policy.windowSeconds,
          Math.max(1, Math.ceil((windowEnd - this.deps.clock.now().getTime()) / 1000)),
        );
        throw new MovementWriteRateLimited(retryAfter);
      }
      const movement = await this.deps.createMovement.execute(scope, input);
      keepUnit = true;
      return movement;
    } finally {
      if (!keepUnit) {
        // A failing refund only makes the limiter stricter (fail safe): it is reported and the
        // error already propagating stands.
        try {
          await this.deps.limiter.release(ownerId, this.policy, reservation.windowStart);
        } catch (error) {
          this.deps.reportReleaseFailure(error);
        }
      }
    }
  }
}
