import { renderPushPayload, type PushNoticeKind } from '../domain/push-payload';
import { processSendLimiter, type Limiter } from './limit-concurrency';
import type { Clock } from './ports/clock';
import type { DueDelivery, PushDeliveryQueue } from './ports/push-delivery-queue';
import type { PushOutcome, PushProvider } from './ports/push-provider';

export const DELIVERY_BATCH_SIZE = 100;
export const PUSH_TTL_SECONDS = 21_600;
const MAX_ATTEMPTS = 5;
const MAX_WAIT_SECONDS = 900;
const BASE_WAIT_SECONDS = 30;

/** Never log anything but ids, a status code and an error class name (NFR-07). */
export interface DeliveryLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface DeliverDuePushesDeps {
  queue: PushDeliveryQueue;
  provider: PushProvider;
  clock: Clock;
  logger: DeliveryLogger;
  /** Defaults to the limiter shared by the whole process. */
  limiter?: Limiter;
}

export interface DeliveryPassResult {
  claimed: number;
}

/** Sends the pending pushes that are due, one device at a time, and records each outcome. */
export class DeliverDuePushes {
  private readonly limiter: Limiter;

  constructor(private readonly deps: DeliverDuePushesDeps) {
    this.limiter = deps.limiter ?? processSendLimiter;
  }

  async execute(): Promise<DeliveryPassResult> {
    let claimed = 0;
    for (;;) {
      const batch = await this.deps.queue.claimDue(this.deps.clock.now(), DELIVERY_BATCH_SIZE);
      if (batch.length === 0) return { claimed };
      claimed += batch.length;
      await Promise.all(batch.map((row) => this.limiter(() => this.handle(row))));
    }
  }

  private async handle(row: DueDelivery): Promise<void> {
    try {
      await this.process(row);
    } catch (error) {
      // The row stays pending under its lease and is claimed again when the lease passes.
      this.deps.logger.error(
        {
          deliveryId: row.id,
          noticeId: row.noticeId,
          errorClass: error instanceof Error ? error.constructor.name : 'unknown',
        },
        'push delivery failed to process',
      );
    }
  }

  private async process(row: DueDelivery): Promise<void> {
    const { queue, provider, clock } = this.deps;
    if (
      row.readAt !== null ||
      row.noticeKind === 'budget_alert' ||
      row.subscriptionOwnerId !== row.noticeOwnerId
    ) {
      await queue.mark(row.id, 'skipped', clock.now());
      return;
    }

    const payload = renderPushPayload({
      noticeId: row.noticeId,
      kind: row.noticeKind as PushNoticeKind,
      language: row.ownerLanguage,
      storedText: row.noticeText,
      dueDate: row.dueDate,
    });
    const outcome = await provider.send({
      target: { pushUrl: row.pushUrl, p256dh: row.p256dh, auth: row.auth },
      body: new TextEncoder().encode(JSON.stringify(payload)),
      ttlSeconds: PUSH_TTL_SECONDS,
      topic: row.noticeId.replaceAll('-', ''),
      urgency: 'normal',
    });
    await this.settle(row, outcome);
  }

  private async settle(row: DueDelivery, outcome: PushOutcome): Promise<void> {
    const { queue, clock, logger } = this.deps;
    const ids = { deliveryId: row.id, noticeId: row.noticeId };
    const now = clock.now();
    switch (outcome.kind) {
      case 'accepted':
        await queue.mark(row.id, 'sent', now);
        return;
      case 'gone':
        await queue.deleteSubscription(row.subscriptionId);
        return;
      case 'rejected':
        await queue.mark(row.id, 'failed', now);
        logger.warn({ ...ids, status: outcome.status }, 'push rejected by the provider');
        return;
      case 'retry': {
        if (row.attempts >= MAX_ATTEMPTS) {
          await queue.mark(row.id, 'failed', now);
          logger.error({ ...ids, status: outcome.status }, 'push gave up after the last attempt');
          return;
        }
        const backoff = BASE_WAIT_SECONDS * (2 ** row.attempts - 1);
        const wait = Math.min(MAX_WAIT_SECONDS, Math.max(backoff, outcome.retryAfterSeconds ?? 0));
        await queue.reschedule(row.id, new Date(now.getTime() + wait * 1000), now);
        return;
      }
    }
  }
}
