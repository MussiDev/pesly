import type { Logger } from '../../../shared/logging/logger';
import type {
  DebitFailure,
  DebitInfo,
  DebitSummary,
} from '../../application/record-automatic-debits';

export const MAX_REPORTED_KEYS = 10_000;

/**
 * The job's log sink. A failure that repeats every pass is logged once per key and error class:
 * the de-duplication set (keys are ids plus the class name, never a message) is cleared when full
 * and only suppresses log lines, it never decides what is recorded. Identifiers only: no amount,
 * account name or card name (spec D11).
 */
export class AutomaticDebitLog {
  private readonly reported = new Set<string>();

  constructor(private readonly logger: Logger) {}

  get size(): number {
    return this.reported.size;
  }

  report = (failure: DebitFailure): void => {
    const key = `${failure.cardId}|${failure.period ?? ''}|${failure.currency ?? ''}|${failure.errorName}`;
    if (this.reported.has(key)) return;
    if (this.reported.size >= MAX_REPORTED_KEYS) this.reported.clear();
    this.reported.add(key);
    this.logger.error(
      {
        cardId: failure.cardId,
        period: failure.period,
        currency: failure.currency,
        errorName: failure.errorName,
      },
      'automatic debit not recorded',
    );
  };

  info = (info: DebitInfo): void => {
    this.logger.info(
      {
        event: info.event,
        cardId: info.cardId,
        period: info.period,
        currency: info.currency,
        reason: info.reason,
      },
      'automatic debit settled',
    );
  };
}

export interface AutomaticDebitJobDependencies {
  execute: () => Promise<DebitSummary>;
  logger: Logger;
  intervalMs: number;
}

/**
 * Runs one pass, waits the interval, repeats (a `setTimeout` chain, so passes never overlap).
 * A pass that throws is logged and the next one still runs; `stop()` waits for the pass in
 * progress and is idempotent. Every pass is idempotent, so any number of workers is safe.
 */
export class AutomaticDebitJob {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly deps: AutomaticDebitJobDependencies) {
    this.intervalMs = deps.intervalMs;
  }

  /** One pass. An error from the use case (storage down) propagates. */
  async runOnce(): Promise<DebitSummary> {
    const summary = await this.deps.execute();
    // An idle pass is the common case (every minute): keep it out of the info stream.
    const didSomething =
      summary.recorded > 0 ||
      summary.skippedCovered > 0 ||
      summary.skippedUnavailable > 0 ||
      summary.skippedRefused > 0 ||
      summary.failed > 0;
    if (didSomething) this.deps.logger.info(summary, 'automatic debits pass');
    else this.deps.logger.debug(summary, 'automatic debits pass');
    return summary;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'automatic debits pass errored');
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
