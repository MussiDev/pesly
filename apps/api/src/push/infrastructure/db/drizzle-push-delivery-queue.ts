import { sql } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  DueDelivery,
  PushDeliveryFinalStatus,
  PushDeliveryQueue,
} from '../../application/ports/push-delivery-queue';

export const LEASE_SECONDS = 120;
export const MAX_ATTEMPTS = 5;
const FINAL_STATUSES: readonly string[] = ['sent', 'failed', 'skipped'];

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  attempts: number;
  notice_id: string;
  kind: string;
  text: string;
  due_date: string;
  read_at: Date | null;
  notice_owner_id: string;
  language: 'es' | 'en';
  subscription_id: string;
  subscription_owner_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class DrizzlePushDeliveryQueue implements PushDeliveryQueue {
  constructor(private readonly db: Database) {}

  async claimDue(now: Date, limit: number): Promise<DueDelivery[]> {
    const at = now.toISOString();
    // A delivery whose fifth attempt never got marked is final: it must not be claimed a sixth time.
    await this.db.execute(sql`
      update push_deliveries
      set status = 'failed', lease_until = null, updated_at = ${at}::timestamptz
      where status = 'pending' and attempts >= ${MAX_ATTEMPTS}
        and lease_until is not null and lease_until <= ${at}::timestamptz`);

    const result = await this.db.execute<ClaimedRow>(sql`
      with due as (
        select id from push_deliveries
        where status = 'pending'
          and next_attempt_at <= ${at}::timestamptz
          and (lease_until is null or lease_until <= ${at}::timestamptz)
        order by next_attempt_at, id
        limit ${limit}
        for update skip locked
      ), claimed as (
        update push_deliveries d
        set attempts = d.attempts + 1,
            lease_until = ${at}::timestamptz + make_interval(secs => ${LEASE_SECONDS}),
            updated_at = ${at}::timestamptz
        from due
        where d.id = due.id
        returning d.id, d.attempts, d.notice_id, d.subscription_id, d.next_attempt_at
      )
      select c.id, c.attempts, c.notice_id, n.kind, n.text, n.due_date::text as due_date,
             n.read_at, n.owner_id as notice_owner_id, u.language,
             c.subscription_id, s.user_id as subscription_owner_id, s.endpoint, s.p256dh, s.auth
      from claimed c
      join notices n on n.id = c.notice_id
      join push_subscriptions s on s.id = c.subscription_id
      join users u on u.id = n.owner_id
      order by c.next_attempt_at, c.id`);

    return result.rows.map((row) => ({
      id: row.id,
      attempts: row.attempts,
      noticeId: row.notice_id,
      noticeKind: row.kind,
      noticeText: row.text,
      dueDate: row.due_date,
      readAt: row.read_at,
      noticeOwnerId: row.notice_owner_id,
      ownerLanguage: row.language,
      subscriptionId: row.subscription_id,
      subscriptionOwnerId: row.subscription_owner_id,
      pushUrl: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
  }

  async mark(id: string, status: PushDeliveryFinalStatus, now: Date): Promise<boolean> {
    if (!FINAL_STATUSES.includes(status)) {
      throw new Error('A delivery can only be marked sent, failed or skipped');
    }
    const at = now.toISOString();
    const result = await this.db.execute(sql`
      update push_deliveries
      set status = ${status}, lease_until = null, updated_at = ${at}::timestamptz,
          sent_at = case when ${status} = 'sent' then ${at}::timestamptz else sent_at end
      where id = ${id}::uuid and status = 'pending'`);
    return (result.rowCount ?? 0) > 0;
  }

  async reschedule(id: string, nextAttemptAt: Date, now: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      update push_deliveries
      set next_attempt_at = ${nextAttemptAt.toISOString()}::timestamptz, lease_until = null,
          updated_at = ${now.toISOString()}::timestamptz
      where id = ${id}::uuid and status = 'pending'`);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.db.execute(sql`delete from push_subscriptions where id = ${subscriptionId}::uuid`);
  }

  async purgeDone(cutoff: Date): Promise<number> {
    const result = await this.db.execute(sql`
      delete from push_deliveries
      where status <> 'pending' and updated_at < ${cutoff.toISOString()}::timestamptz`);
    return result.rowCount ?? 0;
  }
}
