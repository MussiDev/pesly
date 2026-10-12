import type { Database } from '../shared/db/client';
import type { Logger } from '../shared/logging/logger';
import { DeliverDuePushes } from './application/deliver-due-pushes';
import { FanOutNotices } from './application/fan-out-notices';
import type { Clock } from './application/ports/clock';
import type { PushProvider } from './application/ports/push-provider';
import { DrizzlePushDeliveryQueue } from './infrastructure/db/drizzle-push-delivery-queue';
import { DrizzlePushFanOut } from './infrastructure/db/drizzle-push-fan-out';
import { PushJob } from './infrastructure/jobs/push-job';
import { FakePushProvider } from './infrastructure/providers/fake-push-provider';
import { WebPushProvider } from './infrastructure/providers/web-push-provider';

/*
 * The worker side of the module. Deliberately not re-exported from `./index`: the API process
 * imports that barrel and must never reach the delivery queue or the VAPID private key.
 */
export type { PushJob } from './infrastructure/jobs/push-job';
export { FakePushProvider } from './infrastructure/providers/fake-push-provider';

const systemClock: Clock = { now: () => new Date() };

export interface PushProviderSettings {
  PUSH_PROVIDER: string;
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}

/** `webpush` needs the three VAPID settings; anything else is the fake, which opens no connection. */
export function createPushProvider(settings: PushProviderSettings): PushProvider {
  if (settings.PUSH_PROVIDER !== 'webpush') return new FakePushProvider();
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = settings;
  for (const [name, value] of Object.entries({
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
  })) {
    if (!value) throw new Error(`${name} is required when PUSH_PROVIDER=webpush`);
  }
  return new WebPushProvider({
    vapid: {
      publicKey: VAPID_PUBLIC_KEY ?? '',
      privateKey: VAPID_PRIVATE_KEY ?? '',
      subject: VAPID_SUBJECT ?? '',
    },
  });
}

export interface PushJobFactoryDependencies {
  db: Database;
  logger: Logger;
  provider: PushProvider;
  intervalSeconds: number;
  clock?: Clock;
}

/** The push job over the PostgreSQL implementations. */
export function createPushJob({
  db,
  logger,
  provider,
  intervalSeconds,
  clock = systemClock,
}: PushJobFactoryDependencies): PushJob {
  const queue = new DrizzlePushDeliveryQueue(db);
  return new PushJob({
    fanOut: new FanOutNotices(new DrizzlePushFanOut(db), clock),
    deliver: new DeliverDuePushes({ queue, provider, clock, logger }),
    queue,
    clock,
    logger,
    intervalMs: intervalSeconds * 1000,
  });
}
