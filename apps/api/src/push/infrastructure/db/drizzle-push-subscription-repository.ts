import { PUSH_MAX_SUBSCRIPTIONS } from '@pesly/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { PushSubscriptionRepository } from '../../application/manage-push-subscriptions';
import type { NewPushSubscription } from '../../domain/push-subscription';
import { pushSubscriptions } from './schema';

export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: Database) {}

  store(scope: AccessScope<'write'>, subscription: NewPushSubscription): Promise<string> {
    const { userId } = scope;
    return this.db.transaction(async (tx) => {
      // Serialises the stores of one user so the cap below cannot be raced past.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
      const [row] = await tx
        .insert(pushSubscriptions)
        // clock_timestamp(), not now(): a store that waited on the lock above must rank newest.
        .values({ userId, ...subscription, updatedAt: sql`clock_timestamp()` })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            updatedAt: sql`clock_timestamp()`,
          },
        })
        .returning({ id: pushSubscriptions.id });
      if (!row) throw new Error('push subscription upsert returned no row');

      // An owner change: the previous owner's notice text must not reach this browser.
      await tx.execute(sql`
        delete from push_deliveries d
        using notices n
        where d.notice_id = n.id
          and d.subscription_id = ${row.id}
          and d.status = 'pending'
          and n.owner_id <> ${userId}`);

      await tx.execute(sql`
        delete from push_subscriptions
        where user_id = ${userId}
          and id not in (
            select id from push_subscriptions
            where user_id = ${userId}
            order by updated_at desc, id desc
            limit ${PUSH_MAX_SUBSCRIPTIONS})`);
      return row.id;
    });
  }

  async remove(scope: AccessScope<'write'>, endpoint: string): Promise<boolean> {
    const deleted = await this.db
      .delete(pushSubscriptions)
      .where(
        and(
          scopedTo(scope, { owner: pushSubscriptions.userId }),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return deleted.length > 0;
  }
}
