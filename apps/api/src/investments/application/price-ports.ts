import type { ValuationCurrency } from '@pesly/shared';
import type { PriceQuote } from '../domain/crypto-price';
import type { PriceFailureCode } from '../domain/price-failure';

export interface PriceProvider {
  /** Quotes for the symbols it priced; faults surface as `PriceProviderFailure`, never as text. */
  fetchPrices(symbols: readonly string[]): Promise<PriceQuote[]>;
}

export interface PriceClaim {
  /** The lease expiry; it identifies the owner of a running refresh. */
  lease: Date;
  consecutiveFailures: number;
}

/** Single shared schedule row, plus the persisted monthly call counter. */
export interface PriceSchedule {
  /** The claim when this caller owns the refresh, `null` when it is not due or leased. */
  claim(now: Date, leaseMs: number): Promise<PriceClaim | null>;
  /** Resets the failure count. A stale lease changes nothing. */
  succeeded(lease: Date, now: Date, intervalMs: number): Promise<void>;
  /** Counts one more consecutive failure. A stale lease changes nothing. */
  failed(lease: Date, now: Date, retryMs: number): Promise<void>;
  /** Moves the next attempt without touching the failure count. A stale lease changes nothing. */
  deferred(lease: Date, now: Date, delayMs: number): Promise<void>;
  /** Atomically takes one call of the month (`YYYY-MM`, UTC); false when the limit is used up. */
  reserveCall(month: string): Promise<boolean>;
}

export interface CryptoPriceRepository {
  /** Distinct lowercase crypto tickers of every holding, least recently priced first. */
  symbolsToPrice(limit: number): Promise<string[]>;
  /**
   * Stores each market price that is newer than the stored one and applies it to the holdings of
   * the answered symbols that carry no manual price and an older price. Returns the number of
   * market prices stored and of holdings that received an automatic price.
   */
  storeAndApply(
    quotes: readonly PriceQuote[],
    requestedAt: Date,
  ): Promise<{ markets: number; holdings: number }>;
}

export interface PriceFailureRecord {
  at: Date;
  code: PriceFailureCode;
  statusCode?: number;
  detail?: string;
}

export interface PriceFailureLog {
  record(failure: PriceFailureRecord): Promise<void>;
  purgeOlderThan(cutoff: Date): Promise<number>;
}

export interface SnapshotHolding {
  /** Scaled by 10^8. */
  quantity: bigint;
  unitPrice: bigint;
  valuationCurrency: ValuationCurrency;
}

/** A portfolio without a snapshot for the asked date, with its priced holdings only. */
export interface SnapshotCandidate {
  portfolioId: string;
  ownerId: string;
  createdAt: Date;
  holdings: SnapshotHolding[];
}

export interface SnapshotRow {
  portfolioId: string;
  ownerId: string;
  /** `YYYY-MM-DD`, the owner local date. */
  date: string;
  currency: ValuationCurrency;
  totalValue: bigint;
  takenAt: Date;
}

export interface SnapshotRepository {
  zonesInUse(): Promise<string[]>;
  /** Portfolios of the zone with a priced holding and no row for the date, by id after the cursor. */
  portfoliosToSnapshot(
    zone: string,
    date: string,
    afterId: string | null,
    limit: number,
  ): Promise<SnapshotCandidate[]>;
  /** One idempotent insert; returns the number of rows actually written. */
  save(rows: readonly SnapshotRow[]): Promise<number>;
}
