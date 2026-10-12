import { sql } from 'drizzle-orm';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { AccountFlows, NetWorthWindow } from '../../application/ports/net-worth-sources';
import {
  assertCurrency,
  bucketOfAt,
  emptyAmounts,
  foldBuckets,
  instant,
  type BucketedSumRow,
} from './bucketed-sums';

interface AccountRow extends BucketedSumRow {
  opening: boolean;
}

/**
 * The signed effects on the owner's non-archived accounts, one statement: source legs of
 * movements (income positive, the rest negative), destination legs of transfers and exchanges,
 * settlement payments by the `account_member_id` rule, and the opening balances.
 */
export class DrizzleAccountFlowReader {
  constructor(private readonly db: Database) {}

  async accountFlows(scope: AccessScope, window: NetWorthWindow): Promise<AccountFlows> {
    assertIssuedScope(scope);
    const owner = scope.userId;
    const end = instant(window.end);
    const result = await this.db.execute<AccountRow>(sql`
      with legs as (
        select a.currency, m.occurred_at as at,
               case when m.type = 'income' then m.amount else -m.amount end as amount,
               false as opening
        from movements m
        join accounts a on a.id = m.account_id and a.owner_id = m.owner_id
        where m.owner_id = ${owner}::uuid and a.archived_at is null and m.occurred_at < ${end}
        union all
        select a.currency, m.occurred_at, m.destination_amount, false
        from movements m
        join accounts a on a.id = m.destination_account_id and a.owner_id = m.owner_id
        where m.owner_id = ${owner}::uuid and a.archived_at is null and m.occurred_at < ${end}
        union all
        select a.currency, t.occurred_at,
               case when t.account_member_id = t.to_member_id then t.amount
                    when t.account_member_id = t.from_member_id then -t.amount
                    else 0 end,
               false
        from group_settlements t
        join accounts a on a.id = t.account_id
        where a.owner_id = ${owner}::uuid and a.archived_at is null and t.occurred_at < ${end}
        union all
        select a.currency, null::timestamptz, a.opening_balance, true
        from accounts a
        where a.owner_id = ${owner}::uuid and a.archived_at is null
      )
      select currency, opening,
             ${bucketOfAt(window.start, window.timeZone)} as bucket,
             sum(amount)::text as total
      from legs
      group by 1, 2, 3`);

    const opening = emptyAmounts();
    for (const row of result.rows) {
      if (row.opening) opening[assertCurrency(row.currency)] += BigInt(row.total);
    }
    const { baseline, byMonth } = foldBuckets(result.rows.filter((row) => !row.opening));
    return { opening, baseline, byMonth };
  }
}
