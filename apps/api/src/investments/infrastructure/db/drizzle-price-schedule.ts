import { and, eq, lt, lte, sql } from 'drizzle-orm';
import type { PriceClaim, PriceSchedule } from '../../application/price-ports';
import { MONTHLY_CALL_LIMIT } from '../../application/refresh-crypto-prices';
import { cryptoPriceSync, cryptoPriceUsage, type InvestmentsDb } from './schema';

const SCHEDULE_ROW_ID = 1;

const after = (from: Date, ms: number) => new Date(from.getTime() + ms);

/** Times come from the callers' clock, never from the database clock. */
export class DrizzlePriceSchedule implements PriceSchedule {
  constructor(private readonly db: InvestmentsDb) {}

  async claim(now: Date, leaseMs: number): Promise<PriceClaim | null> {
    const lease = after(now, leaseMs);
    // One atomic upsert: it only writes when the row is absent or due, so of two simultaneous
    // claims exactly one gets a returned row.
    const [claimed] = await this.db
      .insert(cryptoPriceSync)
      .values({ id: SCHEDULE_ROW_ID, nextAttemptAt: lease })
      .onConflictDoUpdate({
        target: cryptoPriceSync.id,
        set: { nextAttemptAt: lease },
        setWhere: lte(cryptoPriceSync.nextAttemptAt, now),
      })
      .returning({ consecutiveFailures: cryptoPriceSync.consecutiveFailures });
    return claimed ? { lease, consecutiveFailures: claimed.consecutiveFailures } : null;
  }

  async succeeded(lease: Date, now: Date, intervalMs: number): Promise<void> {
    await this.db
      .update(cryptoPriceSync)
      .set({ nextAttemptAt: after(now, intervalMs), lastSuccessAt: now, consecutiveFailures: 0 })
      .where(this.ownedBy(lease));
  }

  async failed(lease: Date, now: Date, retryMs: number): Promise<void> {
    await this.db
      .update(cryptoPriceSync)
      .set({
        nextAttemptAt: after(now, retryMs),
        consecutiveFailures: sql`${cryptoPriceSync.consecutiveFailures} + 1`,
      })
      .where(this.ownedBy(lease));
  }

  async deferred(lease: Date, now: Date, delayMs: number): Promise<void> {
    await this.db
      .update(cryptoPriceSync)
      .set({ nextAttemptAt: after(now, delayMs) })
      .where(this.ownedBy(lease));
  }

  async reserveCall(month: string): Promise<boolean> {
    // The conditional update is the limit: of two simultaneous reservations at the last call the
    // second one waits on the row, re-checks the condition and gets no returned row.
    const reserved = await this.db
      .insert(cryptoPriceUsage)
      .values({ month, calls: 1 })
      .onConflictDoUpdate({
        target: cryptoPriceUsage.month,
        set: { calls: sql`${cryptoPriceUsage.calls} + 1` },
        setWhere: lt(cryptoPriceUsage.calls, MONTHLY_CALL_LIMIT),
      })
      .returning({ calls: cryptoPriceUsage.calls });
    return reserved.length > 0;
  }

  /** A stale owner's lease no longer matches, so its update changes nothing. */
  private ownedBy(lease: Date) {
    return and(eq(cryptoPriceSync.id, SCHEDULE_ROW_ID), eq(cryptoPriceSync.nextAttemptAt, lease));
  }
}
