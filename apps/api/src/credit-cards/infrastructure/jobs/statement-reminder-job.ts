import type { Logger } from '../../../shared/logging/logger';
import type {
  ReminderFailure,
  ReminderSummary,
} from '../../application/create-statement-reminders';

export const MAX_REPORTED_KEYS = 10_000;

/**
 * The job's log sink. A failure that repeats every pass is logged once per card and error class:
 * the de-duplication set (keys are an id plus the class name, never a message) is cleared when
 * full and only suppresses log lines, it never decides what is created. Identifiers only: no
 * card name, language, amount or time zone (spec D16).
 */
export class StatementReminderLog {
  private readonly reported = new Set<string>();

  constructor(private readonly logger: Logger) {}

  get size(): number {
    return this.reported.size;
  }

  report = (failure: ReminderFailure): void => {
    const key = `${failure.cardId}|${failure.errorName}`;
    if (this.reported.has(key)) return;
    if (this.reported.size >= MAX_REPORTED_KEYS) this.reported.clear();
    this.reported.add(key);
    this.logger.error(
      { cardId: failure.cardId, errorName: failure.errorName },
      'statement reminder not created',
    );
  };
}

export interface StatementReminderJobDependencies {
  execute: () => Promise<ReminderSummary>;
  logger: Logger;
  intervalMs: number;
}

/**
 * Runs one pass, waits the interval, repeats (a `setTimeout` chain, so passes never overlap).
 * A pass that throws is logged and the next one still runs; `stop()` waits for the pass in
 * progress and is idempotent. Every pass is idempotent, so any number of workers is safe.
 */
export class StatementReminderJob {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly deps: StatementReminderJobDependencies) {
    this.intervalMs = deps.intervalMs;
  }

  /** One pass. An error from the use case (storage down) propagates. */
  async runOnce(): Promise<ReminderSummary> {
    const summary = await this.deps.execute();
    // An idle pass is the common case (every minute): keep it out of the info stream.
    if (summary.reminders > 0 || summary.failed > 0) {
      this.deps.logger.info(summary, 'statement reminders pass');
    } else {
      this.deps.logger.debug(summary, 'statement reminders pass');
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
          // Class name only: a storage error message can carry SQL text or values (spec D16).
          const errorName = error instanceof Error ? error.name : typeof error;
          this.deps.logger.error({ errorName }, 'statement reminders pass errored');
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
