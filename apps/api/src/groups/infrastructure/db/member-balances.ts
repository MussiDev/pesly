import { sql } from 'drizzle-orm';
import type { AccountCurrency } from '@pesly/shared';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';

/** A database handle or a transaction on it. */
type Executor = PgDatabase<NodePgQueryResultHKT>;

/**
 * The signed balance of one member in both currencies (spec D1): what they paid, minus their
 * shares, plus the settlement legs they send, minus the ones they receive. Sums run in `numeric`
 * and come back as text, so values past 2^53 stay exact.
 */
export async function memberBalances(
  db: Executor,
  groupId: string,
  memberId: string,
): Promise<Record<AccountCurrency, bigint>> {
  const result = await db.execute<{ currency: AccountCurrency; balance: string }>(sql`
    select c.currency,
      (
        coalesce((select sum(e.amount) from group_expenses e
                  where e.group_id = ${groupId} and e.payer_member_id = ${memberId}
                    and e.currency = c.currency), 0)
        - coalesce((select sum(s.amount) from group_expense_shares s
                    join group_expenses e on e.id = s.expense_id
                    where s.group_id = ${groupId} and s.member_id = ${memberId}
                      and e.currency = c.currency), 0)
        + coalesce((select sum(l.amount) from group_settlement_legs l
                    join group_settlements t on t.id = l.settlement_id
                    where l.group_id = ${groupId} and l.currency = c.currency
                      and t.from_member_id = ${memberId}), 0)
        - coalesce((select sum(l.amount) from group_settlement_legs l
                    join group_settlements t on t.id = l.settlement_id
                    where l.group_id = ${groupId} and l.currency = c.currency
                      and t.to_member_id = ${memberId}), 0)
      )::text as balance
    from (values ('ARS'), ('USD')) as c(currency)
  `);
  const balances: Record<AccountCurrency, bigint> = { ARS: 0n, USD: 0n };
  for (const row of result.rows) balances[row.currency] = BigInt(row.balance);
  return balances;
}
