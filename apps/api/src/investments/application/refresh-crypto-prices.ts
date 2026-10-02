import type { PriceQuote } from '../domain/crypto-price';
import { PriceProviderFailure, type PriceFailureCode } from '../domain/price-failure';
import type { Clock } from './ports';
import type {
  CryptoPriceRepository,
  PriceFailureLog,
  PriceClaim,
  PriceProvider,
  PriceSchedule,
} from './price-ports';

export const REFRESH_INTERVAL_MS = 3_600_000;
export const RETRY_DELAY_MS = 900_000;
export const BACKOFF_CEILING_MS = REFRESH_INTERVAL_MS;
export const LEASE_MS = 300_000;
export const MONTHLY_CALL_LIMIT = 1_000;
export const MAX_SYMBOLS_PER_CALL = 100;

export interface RefreshCryptoPricesDependencies {
  provider: PriceProvider;
  prices: CryptoPriceRepository;
  schedule: PriceSchedule;
  failures: PriceFailureLog;
  clock: Clock;
}

export type RefreshCryptoPricesOutcome =
  | { outcome: 'not_due' }
  | { outcome: 'no_crypto_holdings' }
  | { outcome: 'budget_exhausted' }
  | { outcome: 'refreshed'; markets: number; updated: number; unpriced: number }
  | { outcome: 'failed'; code: PriceFailureCode };

function backoffMs(consecutiveFailures: number): number {
  return Math.min(RETRY_DELAY_MS * 2 ** consecutiveFailures, BACKOFF_CEILING_MS);
}

export class RefreshCryptoPrices {
  constructor(private readonly deps: RefreshCryptoPricesDependencies) {}

  async execute(): Promise<RefreshCryptoPricesOutcome> {
    const { provider, prices, schedule, clock } = this.deps;

    const claim = await schedule.claim(clock.now(), LEASE_MS);
    if (!claim) return { outcome: 'not_due' };
    const { lease } = claim;

    const symbols = await prices.symbolsToPrice(MAX_SYMBOLS_PER_CALL);
    if (symbols.length === 0) {
      await schedule.deferred(lease, clock.now(), REFRESH_INTERVAL_MS);
      return { outcome: 'no_crypto_holdings' };
    }

    // Reserved before the request and never given back, so failed attempts count too.
    const reservedAt = clock.now();
    const month = reservedAt.toISOString().slice(0, 7);
    if (!(await schedule.reserveCall(month))) {
      await schedule.deferred(lease, clock.now(), REFRESH_INTERVAL_MS);
      return { outcome: 'budget_exhausted' };
    }

    // From here a call is spent: whatever goes wrong must still push the next attempt out.
    let quotes: PriceQuote[];
    try {
      quotes = await provider.fetchPrices(symbols);
    } catch (error) {
      if (error instanceof PriceProviderFailure) return this.recordProviderFailure(claim, error);
      await this.advanceBestEffort(claim);
      throw error;
    }

    let stored: { markets: number; holdings: number };
    try {
      stored = await prices.storeAndApply(quotes, reservedAt);
      await schedule.succeeded(lease, clock.now(), REFRESH_INTERVAL_MS);
    } catch (error) {
      await this.advanceBestEffort(claim);
      throw error;
    }

    const answered = new Set(quotes.map((quote) => quote.symbol));
    return {
      outcome: 'refreshed',
      markets: stored.markets,
      updated: stored.holdings,
      unpriced: symbols.filter((symbol) => !answered.has(symbol)).length,
    };
  }

  /** Backoff first, so a failing log cannot skip it; the log is written right after. */
  private async recordProviderFailure(
    claim: PriceClaim,
    error: PriceProviderFailure,
  ): Promise<RefreshCryptoPricesOutcome> {
    const { schedule, failures, clock } = this.deps;
    await schedule.failed(claim.lease, clock.now(), backoffMs(claim.consecutiveFailures));
    await failures.record({
      at: clock.now(),
      code: error.code,
      ...(error.statusCode !== undefined && { statusCode: error.statusCode }),
      ...(error.detail !== undefined && { detail: error.detail }),
    });
    return { outcome: 'failed', code: error.code };
  }

  private async advanceBestEffort(claim: PriceClaim): Promise<void> {
    try {
      await this.deps.schedule.failed(
        claim.lease,
        this.deps.clock.now(),
        backoffMs(claim.consecutiveFailures),
      );
    } catch {
      // Best effort: the original error is the one that matters and the caller rethrows it.
    }
  }
}
