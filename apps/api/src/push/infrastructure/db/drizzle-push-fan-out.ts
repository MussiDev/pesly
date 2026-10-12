import { sql } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type { FanOutBatchResult, PushFanOut } from '../../application/ports/push-fan-out';

const NOTICE_MAX_AGE_MS = 24 * 3_600_000;

export class DrizzlePushFanOut implements PushFanOut {
  constructor(private readonly db: Database) {}

  runBatch({ now, limit }: { now: Date; limit: number }): Promise<FanOutBatchResult> {
    const oldest = new Date(now.getTime() - NOTICE_MAX_AGE_MS);
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`
        select id from notices
        where push_handled_at is null
        order by created_at, id
        limit ${limit}
        for update skip locked`);
      const ids = locked.rows.map((row) => row.id);
      if (ids.length === 0) return { examined: 0, deliveries: 0 };
      const idList = sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      );

      const inserted = await tx.execute(sql`
        insert into push_deliveries (notice_id, subscription_id, next_attempt_at)
        select n.id, s.id, ${now.toISOString()}::timestamptz
        from notices n
        join push_subscriptions s on s.user_id = n.owner_id
        where n.id in (${idList})
          and n.kind <> 'budget_alert'
          and n.read_at is null
          and n.created_at > ${oldest.toISOString()}::timestamptz
        on conflict do nothing
        returning id`);

      await tx.execute(sql`
        update notices set push_handled_at = ${now.toISOString()}::timestamptz
        where id in (${idList})`);
      return { examined: ids.length, deliveries: inserted.rows.length };
    });
  }
}
