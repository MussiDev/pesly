import { AppError } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { NewPushSubscription } from '../domain/push-subscription';

export interface PushSubscriptionRepository {
  /**
   * One transaction under a per-user lock: upsert by endpoint (the endpoint moves to the caller),
   * drop the pending deliveries whose notice is another user's, keep the 10 most recently updated.
   * Returns the id of the subscription.
   */
  store(scope: AccessScope<'write'>, subscription: NewPushSubscription): Promise<string>;
  /** Deletes the caller's row for the endpoint; false when there was none. */
  remove(scope: AccessScope<'write'>, endpoint: string): Promise<boolean>;
}

export class StorePushSubscription {
  constructor(
    private readonly subscriptions: PushSubscriptionRepository,
    /** True when the key is a point of the P-256 curve; node:crypto stays in infrastructure. */
    private readonly isOnCurve: (p256dh: string) => boolean,
  ) {}

  async execute(scope: AccessScope<'write'>, subscription: NewPushSubscription): Promise<string> {
    if (!this.isOnCurve(subscription.p256dh)) {
      throw new AppError('VALIDATION_FAILED', 'VALIDATION_FAILED', ['body.keys.p256dh']);
    }
    return this.subscriptions.store(scope, subscription);
  }
}

export class RemovePushSubscription {
  constructor(private readonly subscriptions: PushSubscriptionRepository) {}

  async execute(scope: AccessScope<'write'>, endpoint: string): Promise<void> {
    notFoundUnlessAllowed((await this.subscriptions.remove(scope, endpoint)) ? true : null);
  }
}
