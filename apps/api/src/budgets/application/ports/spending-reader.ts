import type { AccessScope } from '../../../shared/access';
import type {
  CardPurchaseRow,
  InstallmentSpendingRow,
  PersonalRow,
  ShareRow,
  StatementPlacement,
} from '../../domain/spending';

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
 * The statement fields a card row carries. The reader does not decide the bucket: the use case
 * derives the due month with `statementDueMonth` and compares it to the months asked for.
 */
export type StatementSpendingRow = StatementPlacement;

export interface StatementCardPurchaseRow extends CardPurchaseRow {
  /** How many movements the sum holds. */
  count: number;
}

export type StatementInstallmentRow = InstallmentSpendingRow;

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

  /**
   * The caller's expenses on card accounts, grouped by statement, category, account currency and
   * frozen rate. No purchase-date bound is read: the statement places the purchase, and the rows
   * whose due month is outside the window are the use case's to drop. The time zone gives the
   * purchase its calendar day. An empty `categoryIds` returns no rows without querying.
   */
  cardPurchaseSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
    timeZone: string,
  ): Promise<StatementCardPurchaseRow[]>;

  /**
   * The caller's installments of the statements around the window, grouped by statement, category
   * and purchase currency. An empty `categoryIds` returns no rows without querying.
   */
  installmentSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
  ): Promise<StatementInstallmentRow[]>;
}
