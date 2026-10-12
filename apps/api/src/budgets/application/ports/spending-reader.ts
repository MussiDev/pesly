import type { AccessScope } from '../../../shared/access';
import type { PersonalRow, ShareRow } from '../../domain/spending';

/** A half-open interval `[from, to)` of UTC instants (the bounds of a month in the user's zone). */
export interface SpendingInterval {
  from: Date;
  to: Date;
}

/**
 * The month asked for and, only when some budget needs a rollover, the one before it. The two
 * intervals do not overlap; every row comes back tagged with the bucket it falls in.
 */
export interface SpendingWindow {
  current: SpendingInterval;
  previous: SpendingInterval | null;
}

export type SpendingBucket = 'current' | 'previous';

export interface BucketedPersonalRow extends PersonalRow {
  bucket: SpendingBucket;
  /** How many movements the sum holds. */
  count: number;
}

export interface BucketedShareRow extends ShareRow {
  bucket: SpendingBucket;
  /** How many shares the sum holds. */
  count: number;
}

/**
 * Aggregated spending of the caller, read in one statement each for all budgets (never one per
 * budget). Amounts are minor units of the movement or expense currency, unconverted; conversion
 * is the domain's job (DISC-001-06c D7).
 */
export interface SpendingReader {
  /**
   * The caller's expenses in `categoryIds` inside the window, grouped by category, bucket, account
   * currency and frozen rate; the payer movement of a group expense is left out. An empty
   * `categoryIds` returns no rows without querying.
   */
  personalSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
  ): Promise<BucketedPersonalRow[]>;

  /**
   * The caller's shares of group expenses inside the window, grouped by group category, expense
   * currency, bucket and the rate of the caller's own payer movement (null when someone else paid).
   * Shares of 0 are ignored.
   */
  shareSpending(scope: AccessScope, window: SpendingWindow): Promise<BucketedShareRow[]>;
}
