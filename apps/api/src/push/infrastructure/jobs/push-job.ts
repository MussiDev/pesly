import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports/clock';
import type { PushDeliveryQueue } from '../../application/ports/push-delivery-queue';

const PURGE_EVERY_MS = 3_600_000;
const DONE_RETENTION_MS = 7 * 86_400_000;

export interface PushJobDependencies {
  fanOut: { execute(): Promise<unknown> };
  deliver: { execute(): Promise<unknown> };
  queue: Pick<PushDeliveryQueue, 'purgeDone'>;
  clock: Clock;
  logger: Logger;
  intervalMs: number;
}

/**
 * One pass fans out notices, delivers the due pushes and, at most once an hour, purges finished
 * deliveries. Each step has its own `try/catch`, so a failing step never skips the next one. Passes
 * are a `setTimeout` chain (they never overlap); `stop()` waits for the pass in progress. Every step
 * is idempotent, so any number of workers is safe. Logs carry a class name only: the message of a
 * network error can carry the push URL (NFR-07).
 */
export class PushJob {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private lastPurgeAt: number | undefined;

  constructor(private readonly deps: PushJobDependencies) {
    this.intervalMs = deps.intervalMs;
  }

  /** One pass; it resolves even when a step failed. */
  async runOnce(): Promise<void> {
    await this.step('fan-out', () => this.deps.fanOut.execute());
    await this.step('delivery', () => this.deps.deliver.execute());
    const now = this.deps.clock.now().getTime();
    if (this.lastPurgeAt === undefined || now - this.lastPurgeAt >= PURGE_EVERY_MS) {
      this.lastPurgeAt = now;
      await this.step('purge', () => this.deps.queue.purgeDone(new Date(now - DONE_RETENTION_MS)));
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .catch((error: unknown) => {
          this.logFailure('pass', error);
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

  private async step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logFailure(name, error);
    }
  }

  private logFailure(step: string, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : typeof error;
    this.deps.logger.error({ step, errorClass }, 'push job step failed');
  }
}
