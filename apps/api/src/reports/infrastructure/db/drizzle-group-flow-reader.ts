import { sql } from 'drizzle-orm';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { GroupFlows, NetWorthWindow } from '../../application/ports/net-worth-sources';
import { bucketOfAt, foldBuckets, instant, type BucketedSumRow } from './bucketed-sums';

/**
 * The caller's balance in every group they are a member of, former memberships included, as the
 * signed flows of the `memberBalances` formula: paid, minus shares, plus the legs the member
 * sends, minus the legs they receive; one statement, bucketed by `occurred_at`.
 */
export class DrizzleGroupFlowReader {
  constructor(private readonly db: Database) {}

  async groupFlows(scope: AccessScope, window: NetWorthWindow): Promise<GroupFlows> {
    assertIssuedScope(scope);
    const end = instant(window.end);
    const result = await this.db.execute<BucketedSumRow>(sql`
      with mine as (
        select gm.id from group_members gm where gm.user_id = ${scope.userId}::uuid
      ),
      legs as (
        select e.currency, e.occurred_at as at, e.amount
        from group_expenses e
        join mine on mine.id = e.payer_member_id
        where e.occurred_at < ${end}
        union all
        select e.currency, e.occurred_at, -s.amount
        from group_expense_shares s
        join mine on mine.id = s.member_id
        join group_expenses e on e.id = s.expense_id and e.group_id = s.group_id
        where e.occurred_at < ${end}
        union all
        select l.currency, t.occurred_at, l.amount
        from group_settlement_legs l
        join group_settlements t on t.id = l.settlement_id and t.group_id = l.group_id
        join mine on mine.id = t.from_member_id
        where t.occurred_at < ${end}
        union all
        select l.currency, t.occurred_at, -l.amount
        from group_settlement_legs l
        join group_settlements t on t.id = l.settlement_id and t.group_id = l.group_id
        join mine on mine.id = t.to_member_id
        where t.occurred_at < ${end}
      )
      select currency,
             ${bucketOfAt(window.start, window.timeZone)} as bucket,
             sum(amount)::text as total
      from legs
      group by 1, 2`);
    return foldBuckets(result.rows);
  }
}
