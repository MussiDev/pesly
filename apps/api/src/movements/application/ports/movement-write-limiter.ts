/**
 * Counters of different buckets never share a row, so spending one never moves the other: `manual`
 * is a creation without a device id, `device` one that carries an id chosen by the device.
 */
export const WRITE_LIMIT_BUCKETS = ['manual', 'device'] as const;
export type WriteLimitBucket = (typeof WRITE_LIMIT_BUCKETS)[number];

/** A fixed-window limit: at most `limit` creations of one bucket per `windowSeconds`, per owner. */
export interface WritePolicy {
  limit: number;
  windowSeconds: number;
  bucket: WriteLimitBucket;
}

export interface WriteReservation {
  /** Units held in the current window, including this one. */
  count: number;
  /** False once `count` exceeds the policy's limit. */
  allowed: boolean;
  /** The window the unit was recorded in; pass it to `release` to refund exactly this one. */
  windowStart: Date;
}

/** State lives outside the process so every API instance sees the same counters. */
export interface MovementWriteLimiter {
  record(ownerId: string, policy: WritePolicy): Promise<WriteReservation>;
  /** Gives back one unit of the window `windowStart` (never below zero). */
  release(ownerId: string, policy: WritePolicy, windowStart: Date): Promise<void>;
}
