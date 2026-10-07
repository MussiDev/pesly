import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CardPurchases } from '../../../credit-cards/application/ports/card-purchases';
import type { CreditCard } from '../../../credit-cards/domain/credit-card';
import type { DailyPurchase } from '../../../credit-cards/domain/statement-assignment';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

/**
 * Purchases are the expenses on the card's two linked accounts, summed per account and per local
 * day. Scoped in the same statement: a scope that is not the owner's matches no rows.
 */
class DrizzleCardPurchases implements CardPurchases {
  constructor(private readonly db: Database) {}

  async dailyPurchases(
    scope: AccessScope,
    card: CreditCard,
    timeZone: string,
  ): Promise<DailyPurchase[]> {
    // The zone is a bound parameter; it is never concatenated into the statement.
    const day = sql<string>`to_char(${movements.occurredAt} at time zone ${timeZone}, 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        accountId: movements.accountId,
        day,
        // `sum(bigint)` is numeric: cast to text so the exact value reaches BigInt.
        total: sql<string>`sum(${movements.amount})::text`,
      })
      .from(movements)
      .where(
        and(
          scopedTo(scope, { owner: movements.ownerId }),
          eq(movements.type, 'expense'),
          inArray(movements.accountId, [card.arsAccountId, card.usdAccountId]),
        ),
      )
      // By position: the zone parameter would otherwise be a second, distinct bind in GROUP BY.
      .groupBy(sql`1, 2`);
    return rows.map((row) => ({
      day: row.day,
      currency: row.accountId === card.arsAccountId ? 'ARS' : 'USD',
      amount: BigInt(row.total),
    }));
  }
}

export function createCardPurchases(db: Database): CardPurchases {
  return new DrizzleCardPurchases(db);
}
