import type { Logger } from '../../../shared/logging/logger';
import type {
  RecordFailure,
  RecordInfo,
  RecordSummary,
} from '../../application/record-due-occurrences';

export const MAX_REPORTED_KEYS = 10_000;

/**
 * The job's log sink. A failure that repeats every pass is logged once per occurrence and error
 * class: the de-duplication set (keys are ids plus the class name, never a message) is cleared
 * when full and only suppresses log lines, it never decides what is recorded. Identifiers only.
 */
export class RecordingLog {
  private readonly reported = new Set<string>();

  constructor(private readonly logger: Logger) {}

  get size(): number {
    return this.reported.size;
  }

  report = (failure: RecordFailure): void => {
    const key = `${failure.paymentId}|${failure.occurrenceId ?? ''}|${failure.errorName}`;
    if (this.reported.has(key)) return;
    if (this.reported.size >= MAX_REPORTED_KEYS) this.reported.clear();
    this.reported.add(key);
    this.logger.error(
      {
        paymentId: failure.paymentId,
        occurrenceId: failure.occurrenceId,
        errorName: failure.errorName,
      },
      'recurring payment not recorded',
    );
  };

  info = (info: RecordInfo): void => {
    this.logger.info(
      { event: info.event, paymentId: info.paymentId, occurrenceId: info.occurrenceId },
      'recurring occurrence no longer exists',
    );
  };
}

export interface RecordingJobDependencies {
  execute: () => Promise<RecordSummary>;
  logger: Logger;
  intervalMs: number;
}

/**
 * Runs one pass, waits the interval, repeats (a `setTimeout` chain, so passes never overlap).
 * A pass that throws is logged and the next one still runs; `stop()` waits for the pass in
 * progress and is idempotent. Every pass is idempotent, so any number of workers is safe.
 */
export class RecordingJob {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly deps: RecordingJobDependencies) {
    this.intervalMs = deps.intervalMs;
  }

  /** One pass. An error from the use case (storage down) propagates. */
  async runOnce(): Promise<RecordSummary> {
    const summary = await this.deps.execute();
    // An idle pass is the common case (every minute): keep it out of the info stream.
    const didSomething =
      summary.recorded > 0 || summary.failed > 0 || summary.skippedAlreadyResolved > 0;
    if (didSomething) this.deps.logger.info(summary, 'recurring payments recorded');
    else this.deps.logger.debug(summary, 'recurring payments recorded');
    return summary;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'recurring payments pass errored');
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
        });
    };
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
