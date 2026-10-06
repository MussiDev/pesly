import { ResourceNotFound, type AccessScope } from '../../shared/access';
import { DuplicateMovementId, MovementWriteRateLimited } from '../domain/errors';
import type { Movement } from '../domain/movement';
import type { CreateMovement, CreateMovementInput } from './create-movement';
import type { Clock } from './ports/clock';
import type { MovementRepository } from './ports/movement-repository';
import type { MovementWriteLimiter, WritePolicy } from './ports/movement-write-limiter';
import { MOVEMENT_WRITE_WINDOW_SECONDS } from './record-manual-movement';

/** Enough for a device to send a long queue in one go, and still a hard cap per user. */
export const DEFAULT_DEVICE_WRITE_LIMIT = 600;

export interface RecordDeviceMovementDependencies {
  createMovement: CreateMovement;
  movements: MovementRepository;
  limiter: MovementWriteLimiter;
  clock: Clock;
  /** Called when the refund of a unit fails; the caller still gets the original outcome. */
  reportReleaseFailure: (error: unknown) => void;
}

export interface DeviceMovementOutcome {
  movement: Movement;
  /** `false` when the movement already existed for the caller and nothing was written. */
  created: boolean;
}

/**
 * What the route calls for a creation that carries an id chosen by the device: an idempotent
 * `CreateMovement`. The same owner sending an id that exists gets the stored movement back, with no
 * validation and no limit unit spent, so a retry never fails for something that changed since. An id
 * that belongs to another user answers like any data that is not the caller's: not found.
 */
export class RecordDeviceMovement {
  private readonly policy: WritePolicy;

  constructor(
    private readonly deps: RecordDeviceMovementDependencies,
    writeLimit: number = DEFAULT_DEVICE_WRITE_LIMIT,
  ) {
    if (!Number.isInteger(writeLimit) || writeLimit < 1) {
      throw new RangeError('writeLimit must be an integer of at least 1');
    }
    this.policy = {
      limit: writeLimit,
      windowSeconds: MOVEMENT_WRITE_WINDOW_SECONDS,
      bucket: 'device',
    };
  }

  async execute(
    scope: AccessScope<'write'>,
    id: string,
    input: CreateMovementInput,
  ): Promise<DeviceMovementOutcome> {
    // A scoped read: another owner's movement is never found here.
    const existing = await this.deps.movements.findById(scope, id);
    if (existing !== null) return { movement: existing, created: false };

    const ownerId = scope.userId;
    const reservation = await this.deps.limiter.record(ownerId, this.policy);

    // Only a movement saved now keeps its unit; every other way out refunds it.
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
      try {
        const movement = await this.deps.createMovement.execute(scope, input, id);
        keepUnit = true;
        return { movement, created: true };
      } catch (error) {
        if (!(error instanceof DuplicateMovementId)) throw error;
        // Lost a race on the id: if the winner is the caller's own, this is a replay.
        const winner = await this.deps.movements.findById(scope, id);
        if (winner === null) throw new ResourceNotFound();
        return { movement: winner, created: false };
      }
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
