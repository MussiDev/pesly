import {
  pushConfigResponseSchema,
  pushSubscriptionRequestSchema,
  pushSubscriptionResponseSchema,
  unsubscribeRequestSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessAction,
  type AccessPolicy,
  type AccessScope,
} from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type { AuthContext } from '../../../shared/http/auth-context';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import {
  RemovePushSubscription,
  StorePushSubscription,
} from '../../application/manage-push-subscriptions';
import { isOnCurveP256dh } from '../crypto/p256-point';
import { DrizzlePushSubscriptionRepository } from '../db/drizzle-push-subscription-repository';

export interface PushRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** The VAPID public key (base64url); null or undefined when push is not configured. */
  publicKey: string | null | undefined;
}

function scopeOf<A extends AccessAction>(
  policy: AccessPolicy,
  auth: AuthContext | undefined,
  action: A,
): Promise<AccessScope<A>> {
  // requireSession always sets auth before these routes; failing closed keeps that explicit.
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
  return policy.scopeFor(auth, action);
}

/** `/push`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createPushRoutes({ db, logger, publicKey }: PushRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const repository = new DrizzlePushSubscriptionRepository(db);
  const storeSubscription = new StorePushSubscription(repository, isOnCurveP256dh);
  const removeSubscription = new RemovePushSubscription(repository);
  const key = publicKey ?? null;

  return ({ requireSession }) => {
    const router = Router();
    router.use('/push', requireSession, requireVerifiedEmail);

    router.get(
      '/push/config',
      validate({ response: pushConfigResponseSchema }, async (_input, { res, auth }) => {
        await scopeOf(policy, auth, 'read');
        res.json(key ? { available: true, publicKey: key } : { available: false, publicKey: null });
      }),
    );

    router.put(
      '/push/subscriptions',
      validate(
        { body: pushSubscriptionRequestSchema, response: pushSubscriptionResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const id = await storeSubscription.execute(scope, {
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
          });
          // Ids only: the endpoint and the keys never reach the log.
          logger.info(
            { requestId, userId: scope.userId, subscriptionId: id },
            'push subscription stored',
          );
          res.json({ id });
        },
      ),
    );

    // A POST with a body, not a DELETE with a query: the endpoint must stay out of access logs.
    router.post(
      '/push/subscriptions/unsubscribe',
      validate({ body: unsubscribeRequestSchema }, async ({ body }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        await removeSubscription.execute(scope, body.endpoint);
        logger.info({ requestId, userId: scope.userId }, 'push subscription removed');
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
