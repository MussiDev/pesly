import type { Logger } from '../../../shared/logging/logger';
import type { ReminderFailure, ReminderSummary } from '../../application/create-due-reminders';
import { MAX_REPORTED_KEYS } from './recording-job';

/**
 * The job's log sink. A failure that repeats every pass is logged once per payment (or page) and
 * error class; the set only suppresses log lines and never decides what is created. Identifiers
 * and the class name only.
 */
export class ReminderLog {
  private readonly reported = new Set<string>();

  constructor(private readonly logger: Logger) {}

  report = (failure: ReminderFailure): void => {
    const key = `${failure.paymentId ?? ''}|${failure.afterId ?? ''}|${failure.errorName}`;
    if (this.reported.has(key)) return;
    if (this.reported.size >= MAX_REPORTED_KEYS) this.reported.clear();
    this.reported.add(key);
    this.logger.error(
      {
        paymentId: failure.paymentId,
        afterId: failure.afterId,
        errorName: failure.errorName,
      },
      'recurring reminder not created',
    );
  };
}

export interface ReminderJobDependencies {
  execute: () => Promise<ReminderSummary>;
  logger: Logger;
  intervalMs: number;
}

/**
 * Runs one pass, waits the interval, repeats (a `setTimeout` chain, so passes never overlap).
 * A pass that throws is logged and the next one still runs; `stop()` waits for the pass in
 * progress and is idempotent. Every pass is idempotent, so any number of workers is safe.
 */
export class ReminderJob {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly deps: ReminderJobDependencies) {
    this.intervalMs = deps.intervalMs;
  }

  /** One pass. An error from the use case (storage down) propagates. */
  async runOnce(): Promise<ReminderSummary> {
    const summary = await this.deps.execute();
    // An idle pass is the common case (every minute): keep it out of the info stream.
    if (summary.reminders > 0 || summary.failed > 0) {
      this.deps.logger.info(summary, 'recurring reminders created');
    } else {
      this.deps.logger.debug(summary, 'recurring reminders created');
    }
    return summary;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'recurring reminders pass errored');
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
