import { sql } from 'drizzle-orm';
import type { AccountCurrency } from '@pesly/shared';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type {
  GroupBalanceReader,
  GroupBalanceSource,
} from '../../application/ports/group-balance-reader';

/** `source` is `member`, `paid`, `shares` or `legs`; anything else is an invariant error. */
export type SourceRow = {
  group_id: string;
  member_id: string;
  source: string;
  currency: string;
  total: string;
};

interface MutableSources {
  paid: Map<string, bigint>;
  shares: Map<string, bigint>;
  legs: Map<string, bigint>;
}

function emptySources(): MutableSources {
  return { paid: new Map(), shares: new Map(), legs: new Map() };
}

function isCurrency(value: string): value is AccountCurrency {
  return value === 'ARS' || value === 'USD';
}

/** Folds the rows of the single statement into one entry per member row of the caller. */
export function foldSourceRows(rows: readonly SourceRow[]): GroupBalanceSource[] {
  const entries = new Map<string, GroupBalanceSource>();
  const mutable = new Map<string, Record<AccountCurrency, MutableSources>>();
  for (const row of rows) {
    if (!isCurrency(row.currency)) {
      throw new Error(`Unknown currency "${row.currency}" in a group balance source`);
    }
    let sources = mutable.get(row.member_id);
    if (!sources) {
      sources = { ARS: emptySources(), USD: emptySources() };
      mutable.set(row.member_id, sources);
      entries.set(row.member_id, { groupId: row.group_id, memberId: row.member_id, sources });
    }
    if (row.source === 'member') continue;
    if (row.source !== 'paid' && row.source !== 'shares' && row.source !== 'legs') {
      throw new Error(`Unknown group balance source "${row.source}"`);
    }
    const target = sources[row.currency][row.source];
    target.set(row.member_id, (target.get(row.member_id) ?? 0n) + BigInt(row.total));
  }
  return [...entries.values()];
}

/**
 * The 04e balance formula for every member row of the caller in one statement: expense amounts
 * paid, shares, and settlement legs sent minus received. Sums are `numeric` read as text.
 */
export class DrizzleGroupBalanceReader implements GroupBalanceReader {
  constructor(private readonly db: Database) {}

  async sourcesOf(scope: AccessScope): Promise<GroupBalanceSource[]> {
    assertIssuedScope(scope);
    const result = await this.db.execute<SourceRow>(sql`
      with mine as (
        select gm.id, gm.group_id from group_members gm where gm.user_id = ${scope.userId}::uuid
      ),
      parts as (
        select mine.group_id, mine.id as member_id, 'member' as source, 'ARS'::text as currency,
               0::numeric as amount
        from mine
        union all
        select mine.group_id, mine.id, 'paid', e.currency::text, e.amount
        from group_expenses e
        join mine on mine.id = e.payer_member_id
        union all
        select mine.group_id, mine.id, 'shares', e.currency::text, s.amount
        from group_expense_shares s
        join mine on mine.id = s.member_id
        join group_expenses e on e.id = s.expense_id and e.group_id = s.group_id
        union all
        select mine.group_id, mine.id, 'legs', l.currency::text, l.amount
        from group_settlement_legs l
        join group_settlements t on t.id = l.settlement_id and t.group_id = l.group_id
        join mine on mine.id = t.from_member_id
        union all
        select mine.group_id, mine.id, 'legs', l.currency::text, -l.amount
        from group_settlement_legs l
        join group_settlements t on t.id = l.settlement_id and t.group_id = l.group_id
        join mine on mine.id = t.to_member_id
      )
      select group_id, member_id, source, currency, sum(amount)::text as total
      from parts
      group by group_id, member_id, source, currency
    `);
    // 'shares' enter the formula negated by `computeBalances`, so they stay positive here.
    return foldSourceRows(result.rows);
  }
}
