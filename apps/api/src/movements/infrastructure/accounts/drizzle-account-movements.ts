import { eq, inArray, or, sql } from 'drizzle-orm';
import type { AccountMovements } from '../../../accounts/application/ports/account-movements';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

const CHUNK_SIZE = 500;

/**
 * Both sides of a movement count: the source column loses (or gains, for income) `amount`, the
 * destination column of a transfer or exchange gains `destination_amount`.
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
      for (const row of sources) addTo(sums, row.accountId, BigInt(row.total));
      for (const row of destinations) {
        // The filter above excludes null destinations, so this guard only narrows the type.
        if (row.accountId !== null) addTo(sums, row.accountId, BigInt(row.total));
      }
    }
    return sums;
  }

  async hasMovements(accountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(movements)
      .where(or(eq(movements.accountId, accountId), eq(movements.destinationAccountId, accountId)))
      .limit(1);
    return row !== undefined;
  }
}

function addTo(sums: Map<string, bigint>, accountId: string, amount: bigint): void {
  sums.set(accountId, (sums.get(accountId) ?? 0n) + amount);
}

export function createAccountMovements(db: Database): AccountMovements {
  return new DrizzleAccountMovements(db);
}
