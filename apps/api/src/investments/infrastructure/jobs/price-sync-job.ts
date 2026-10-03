import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports';
import type { PriceFailureLog } from '../../application/price-ports';
import type {
  RefreshCryptoPrices,
  RefreshCryptoPricesOutcome,
} from '../../application/refresh-crypto-prices';

export const PRICE_POLL_INTERVAL_MS = 30_000;
const HOUR_MS = 60 * 60 * 1000;
const PURGE_INTERVAL_MS = HOUR_MS;
const FAILURE_RETENTION_MS = 30 * 24 * HOUR_MS;

export interface PriceSyncJobDependencies {
  refresh: Pick<RefreshCryptoPrices, 'execute'>;
  failures: Pick<PriceFailureLog, 'purgeOlderThan'>;
  clock: Clock;
  logger: Logger;
  pollIntervalMs?: number;
}

/**
 * Polls the shared price schedule: every pass asks `RefreshCryptoPrices` whether a refresh is due
 * (the claim is atomic, so any number of workers make at most one provider call per hour) and
 * purges old failure records at most once an hour. Logs carry outcomes, codes and counts only:
 * never an amount, provider text or the key.
 */
export class PriceSyncJob {
  private readonly pollIntervalMs: number;
  private lastPurgeAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private stopRequested = false;

  constructor(private readonly deps: PriceSyncJobDependencies) {
    this.pollIntervalMs = deps.pollIntervalMs ?? PRICE_POLL_INTERVAL_MS;
  }

  /** One pass: the purge if due, then the refresh if due. A storage error propagates. */
  async runOnce(): Promise<RefreshCryptoPricesOutcome> {
    await this.purgeIfDue();
    if (this.stopRequested) return { outcome: 'not_due' };
    const result = await this.deps.refresh.execute();
    const { logger } = this.deps;
    if (result.outcome === 'refreshed') {
      logger.info(
        { markets: result.markets, updated: result.updated, unpriced: result.unpriced },
        'crypto prices refreshed',
      );
    } else if (result.outcome === 'failed') {
      logger.warn({ code: result.code }, 'crypto price refresh failed');
    } else if (result.outcome === 'budget_exhausted') {
      logger.warn('crypto price monthly call budget exhausted');
    }
    return result;
  }

  /** Polls every `pollIntervalMs` until `stop()`; a failed pass is logged and the next one runs. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'crypto price refresh errored');
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.pollIntervalMs);
        });
    };
    tick();
  }

  /** Stops polling; the pass in progress finishes its current statement and starts no new call. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRequested = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async purgeIfDue(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    if (this.lastPurgeAt !== undefined && now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;
    // A failed purge must not stop the refresh; it is retried at the next purge interval.
    try {
      const deleted = await this.deps.failures.purgeOlderThan(new Date(now - FAILURE_RETENTION_MS));
      this.deps.logger.debug({ deleted }, 'crypto price failure purge done');
    } catch (error) {
      this.deps.logger.error({ err: error }, 'crypto price failure purge failed');
    }
  }
}
