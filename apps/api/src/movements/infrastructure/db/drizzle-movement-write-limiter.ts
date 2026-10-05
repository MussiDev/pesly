import { and, eq, lt, sql } from 'drizzle-orm';
import type {
  MovementWriteLimiter,
  WritePolicy,
  WriteReservation,
} from '../../application/ports/movement-write-limiter';
import type { Clock } from '../../application/ports/clock';
import type { Database } from '../../../shared/db/client';
import { movementRateLimits } from './schema';

/**
 * Fixed windows aligned to the Unix epoch, so every API instance maps the same instant to the same
 * `window_start` without coordinating (NFR-08).
 */
function windowStartOf(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export class DrizzleMovementWriteLimiter implements MovementWriteLimiter {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Drops the owner's older windows of the policy's bucket (keeping the table at about one row per
   * user and bucket), then one atomic upsert, so concurrent calls from several instances never lose
   * an increment.
   */
  async record(ownerId: string, policy: WritePolicy): Promise<WriteReservation> {
    const windowStart = windowStartOf(this.clock.now(), policy.windowSeconds);
    return this.db.transaction(async (tx) => {
      await tx
        .delete(movementRateLimits)
        .where(
          and(
            eq(movementRateLimits.ownerId, ownerId),
            eq(movementRateLimits.bucket, policy.bucket),
            lt(movementRateLimits.windowStart, windowStart),
          ),
        );
      const [row] = await tx
        .insert(movementRateLimits)
        .values({ ownerId, bucket: policy.bucket, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [
            movementRateLimits.ownerId,
            movementRateLimits.bucket,
            movementRateLimits.windowStart,
          ],
          set: { count: sql`${movementRateLimits.count} + 1` },
        })
        .returning({ count: movementRateLimits.count });
      if (!row) throw new Error('Upsert into movement_rate_limits returned no row');
      return { count: row.count, allowed: row.count <= policy.limit, windowStart };
    });
  }

  /** Decrements the given window's row of the policy's bucket only: a late refund never touches a newer window. */
  async release(ownerId: string, policy: WritePolicy, windowStart: Date): Promise<void> {
    await this.db
      .update(movementRateLimits)
      .set({ count: sql`greatest(${movementRateLimits.count} - 1, 0)` })
      .where(
        and(
          eq(movementRateLimits.ownerId, ownerId),
          eq(movementRateLimits.bucket, policy.bucket),
          eq(movementRateLimits.windowStart, windowStart),
        ),
      );
  }
}
