import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports';
import type {
  TakeDailySnapshots,
  TakeDailySnapshotsResult,
} from '../../application/take-daily-snapshots';

export const SNAPSHOT_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface SnapshotJobDependencies {
  snapshots: Pick<TakeDailySnapshots, 'execute'>;
  clock: Clock;
  logger: Logger;
  pollIntervalMs?: number;
}

/**
 * Polls the daily snapshot use case: every pass stores what is missing for each zone previous
 * local day, which is idempotent, so any number of workers and passes are safe. Logs carry counts,
 * zones, dates and portfolio ids only, never an amount.
 */
export class SnapshotJob {
  private readonly pollIntervalMs: number;
  /** Out-of-range skips already logged (`zone|date|portfolio`); it only suppresses repeats. */
  private reported = new Set<string>();
  /** Invalid zones already logged; it only suppresses repeats. */
  private reportedZones = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly deps: SnapshotJobDependencies) {
    this.pollIntervalMs = deps.pollIntervalMs ?? SNAPSHOT_POLL_INTERVAL_MS;
  }

  /** One pass. A storage error propagates. */
  async runOnce(): Promise<TakeDailySnapshotsResult> {
    const { logger, snapshots, clock } = this.deps;
    const result = await snapshots.execute(clock.now());

    // Only the skips of this pass are kept, so the set stays as small as the skips themselves.
    const current = new Set<string>();
    for (const skipped of result.outOfRange) {
      const key = `${skipped.zone}|${skipped.date}|${skipped.portfolioId}`;
      current.add(key);
      if (this.reported.has(key)) continue;
      logger.error(
        { zone: skipped.zone, date: skipped.date, portfolioId: skipped.portfolioId },
        'snapshot skipped: total out of range',
      );
    }
    this.reported = current;

    const currentZones = new Set<string>();
    for (const zone of result.invalidZones) {
      currentZones.add(zone);
      if (this.reportedZones.has(zone)) continue;
      logger.warn({ zone }, 'snapshot skipped: invalid time zone');
    }
    this.reportedZones = currentZones;

    const summary = {
      saved: result.saved,
      skippedOutOfRange: result.skippedOutOfRange,
      skippedZones: result.skippedZones,
    };
    // A pass that did nothing is the common case (every 5 minutes): keep it out of the info stream.
    const didSomething =
      result.saved > 0 || result.skippedOutOfRange > 0 || result.skippedZones > 0;
    if (didSomething) logger.info(summary, 'daily snapshots taken');
    else logger.debug(summary, 'daily snapshots taken');
    return result;
  }

  /** Polls every `pollIntervalMs` until `stop()`; a failed pass is logged and the next one runs. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'daily snapshots errored');
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.pollIntervalMs);
        });
    };
    tick();
  }

  /** Stops polling and waits for the pass in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
