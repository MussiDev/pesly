import { eq, inArray, or, sql } from 'drizzle-orm';
import type { AccountMovements } from '../../../accounts/application/ports/account-movements';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

const CHUNK_SIZE = 500;

/**
 * Both sides of a movement count: the source column loses (or gains, for income) `amount`, the
 * destination column of a transfer or exchange gains `destination_amount`. A group settlement
 * that names the account adds its cash when the account owner is the receiving member and
 * subtracts it when they are the paying one (spec 05c D5); it is not a movement, so no movement
 * total changes.
 *
 * UNSCOPED BY DESIGN (see the port): every result is keyed by the ids it was given, and rows of
 * other accounts are never selected.
 */
class DrizzleAccountMovements implements AccountMovements {
  constructor(private readonly db: Database) {}

  async sumsByAccount(accountIds: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    const sums = new Map<string, bigint>();
    for (let start = 0; start < accountIds.length; start += CHUNK_SIZE) {
      const chunk = accountIds.slice(start, start + CHUNK_SIZE);
      // `sum(bigint)` is numeric: cast to text so the exact value reaches BigInt.
      const sources = await this.db
        .select({
          accountId: movements.accountId,
          total: sql<string>`sum(case ${movements.type} when 'income' then ${movements.amount} else -${movements.amount} end)::text`,
        })
        .from(movements)
        .where(inArray(movements.accountId, chunk))
        .groupBy(movements.accountId);
      const destinations = await this.db
        .select({
          accountId: movements.destinationAccountId,
          total: sql<string>`sum(${movements.destinationAmount})::text`,
        })
        .from(movements)
        .where(inArray(movements.destinationAccountId, chunk))
        .groupBy(movements.destinationAccountId);
      const settled = await this.db.execute<{ account_id: string; total: string }>(sql`
        select account_id, sum(
          case when account_member_id = to_member_id then amount
               when account_member_id = from_member_id then -amount
               else 0 end)::text as total
        from group_settlements
        where account_id in (${sql.join(
          chunk.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        group by account_id`);
      for (const row of sources) addTo(sums, row.accountId, BigInt(row.total));
      for (const row of destinations) {
        // The filter above excludes null destinations, so this guard only narrows the type.
        if (row.accountId !== null) addTo(sums, row.accountId, BigInt(row.total));
      }
      for (const row of settled.rows) addTo(sums, row.account_id, BigInt(row.total));
    }
    return sums;
  }

  async hasMovements(accountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(movements)
      .where(or(eq(movements.accountId, accountId), eq(movements.destinationAccountId, accountId)))
      .limit(1);
    if (row !== undefined) return true;
    // Read as SQL: `request-path.test.ts` keeps this module off other modules' persistence files.
    const settlements = await this.db.execute(
      sql`select 1 from group_settlements where account_id = ${accountId}::uuid limit 1`,
    );
    return settlements.rows.length > 0;
  }
}

function addTo(sums: Map<string, bigint>, accountId: string, amount: bigint): void {
  sums.set(accountId, (sums.get(accountId) ?? 0n) + amount);
}

export function createAccountMovements(db: Database): AccountMovements {
  return new DrizzleAccountMovements(db);
}
