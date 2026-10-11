import { and, eq, inArray } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { AccountBalances, LinkableAccount } from '../../application/ports/account-balances';
import { accounts } from './foreign-relations';

/** Largest id list handed to the movement sums in one call (NFR-02). */
const SUMS_CHUNK_SIZE = 500;

/** Movement sums per account id, injected from the movements module at the composition root. */
export type AccountMovementSums = (
  accountIds: readonly string[],
) => Promise<ReadonlyMap<string, bigint>>;

export class DrizzleAccountBalances implements AccountBalances {
  constructor(
    private readonly db: Database,
    private readonly movementSums: AccountMovementSums,
  ) {}

  async findLinkable(scope: AccessScope, accountId: string): Promise<LinkableAccount | null> {
    const [row] = await this.db
      .select({ id: accounts.id, currency: accounts.currency, archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), scopedTo(scope, { owner: accounts.ownerId })))
      .limit(1);
    return row ? { id: row.id, currency: row.currency, archived: row.archivedAt !== null } : null;
  }

  async balancesOf(
    scope: AccessScope,
    accountIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    const balances = new Map<string, bigint>();
    if (accountIds.length === 0) return balances;
    // Ownership is checked here, in the same statement that reads the opening balances.
    const opening = await this.db
      .select({ id: accounts.id, openingBalance: accounts.openingBalance })
      .from(accounts)
      .where(
        and(inArray(accounts.id, [...accountIds]), scopedTo(scope, { owner: accounts.ownerId })),
      );
    const sums = new Map<string, bigint>();
    // A failure of the sums propagates: no balance is ever guessed.
    for (let start = 0; start < opening.length; start += SUMS_CHUNK_SIZE) {
      const chunk = opening.slice(start, start + SUMS_CHUNK_SIZE).map((row) => row.id);
      for (const [id, sum] of await this.movementSums(chunk)) sums.set(id, sum);
    }
    for (const row of opening) balances.set(row.id, row.openingBalance + (sums.get(row.id) ?? 0n));
    return balances;
  }
}
