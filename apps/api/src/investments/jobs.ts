import type { Database } from '../shared/db/client';
import type { Logger } from '../shared/logging/logger';
import type { Clock } from './application/ports';
import type { PriceProvider } from './application/price-ports';
import { RefreshCryptoPrices } from './application/refresh-crypto-prices';
import { TakeDailySnapshots } from './application/take-daily-snapshots';
import { DrizzleCryptoPriceRepository } from './infrastructure/db/drizzle-crypto-price-repository';
import { DrizzlePriceFailureLog } from './infrastructure/db/drizzle-price-failure-log';
import { DrizzlePriceSchedule } from './infrastructure/db/drizzle-price-schedule';
import { DrizzleSnapshotRepository } from './infrastructure/db/drizzle-snapshot-repository';
import { PriceSyncJob } from './infrastructure/jobs/price-sync-job';
import { SnapshotJob } from './infrastructure/jobs/snapshot-job';
import { systemClock } from './infrastructure/system-clock';

/*
 * The worker side of the module. Deliberately not re-exported from `./index`: the API process
 * imports that barrel, and no provider, job or worker repository may be reachable from a user
 * request (AGENTS.md: external services never in the request path).
 */
export { CoingeckoPriceProvider } from './infrastructure/provider/coingecko-price-provider';
export { FakePriceProvider } from './infrastructure/provider/fake-price-provider';
export type { PriceProvider } from './application/price-ports';
export type { PriceSyncJob } from './infrastructure/jobs/price-sync-job';
export type { SnapshotJob } from './infrastructure/jobs/snapshot-job';

export interface SnapshotJobFactoryDependencies {
  db: Database;
  logger: Logger;
  clock?: Clock;
}

export interface PriceSyncJobFactoryDependencies extends SnapshotJobFactoryDependencies {
  provider: PriceProvider;
}

/** The price sync job over the PostgreSQL repositories, schedule and failure log. */
export function createPriceSyncJob({
  db,
  provider,
  logger,
  clock = systemClock,
}: PriceSyncJobFactoryDependencies): PriceSyncJob {
  const failures = new DrizzlePriceFailureLog(db);
  const refresh = new RefreshCryptoPrices({
    provider,
    prices: new DrizzleCryptoPriceRepository(db),
    schedule: new DrizzlePriceSchedule(db),
    failures,
    clock,
  });
  return new PriceSyncJob({ refresh, failures, clock, logger });
}

/** The daily snapshot job over the PostgreSQL snapshot repository. */
export function createSnapshotJob({
  db,
  logger,
  clock = systemClock,
}: SnapshotJobFactoryDependencies): SnapshotJob {
  const snapshots = new TakeDailySnapshots({ snapshots: new DrizzleSnapshotRepository(db) });
  return new SnapshotJob({ snapshots, clock, logger });
}

export interface InvestmentsJobs {
  start(): void;
  /** Stops both jobs and waits for the passes in progress; stopping twice is harmless. */
  stop(): Promise<void>;
}

export function createInvestmentsJobs(
  dependencies: PriceSyncJobFactoryDependencies,
): InvestmentsJobs {
  const priceSync = createPriceSyncJob(dependencies);
  const snapshots = createSnapshotJob(dependencies);
  return {
    start() {
      priceSync.start();
      snapshots.start();
    },
    async stop() {
      // One failing stop must not skip waiting for the other; the first failure is rethrown after.
      const settled = await Promise.allSettled([priceSync.stop(), snapshots.stop()]);
      const failed = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    },
  };
}
