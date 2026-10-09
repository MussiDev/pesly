import { dateInTimeZone } from '@pesly/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CardPurchases } from '../../../credit-cards/application/ports/card-purchases';
import type { CreditCard } from '../../../credit-cards/domain/credit-card';
import type { DailyPurchase } from '../../../credit-cards/domain/statement-assignment';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

/** Every UTC offset in use is a multiple of 15 minutes, so a local day starts on a bucket edge. */
const BUCKET_SECONDS = 900;

/**
 * Purchases are the expenses on the card's two linked accounts, summed per account and per local
 * day. Scoped in the same statement: a scope that is not the owner's matches no rows.
 *
 * The local day is worked out here and not with `at time zone` in SQL: the zone name is validated
 * by the runtime's tz database, and a database built on a different one (a deployment image
 * without the legacy aliases, such as `America/Buenos_Aires`) rejects names the API accepts
 * (error 22023). The database sums per 15-minute bucket, which is exact because no zone offset
 * splits a bucket, and the days are assigned from the bucket start.
 */
class DrizzleCardPurchases implements CardPurchases {
  constructor(private readonly db: Database) {}

  async dailyPurchases(
    scope: AccessScope,
    card: CreditCard,
    timeZone: string,
  ): Promise<DailyPurchase[]> {
    // The instant the bucket starts at, as UTC text (`'UTC'` is built into every PostgreSQL).
    const bucket = sql<string>`to_char(to_timestamp(floor(extract(epoch from ${movements.occurredAt}) / ${BUCKET_SECONDS}) * ${BUCKET_SECONDS}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
    const rows = await this.db
      .select({
        accountId: movements.accountId,
        bucket,
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
      // By position: the bucket expression would otherwise be repeated in GROUP BY.
      .groupBy(sql`1, 2`);
    const perDay = new Map<string, DailyPurchase>();
    for (const row of rows) {
      const day = dateInTimeZone(new Date(row.bucket), timeZone);
      const currency = row.accountId === card.arsAccountId ? 'ARS' : 'USD';
      const key = `${day}|${currency}`;
      const sum = perDay.get(key);
      if (sum) sum.amount += BigInt(row.total);
      else perDay.set(key, { day, currency, amount: BigInt(row.total) });
    }
    return [...perDay.values()];
  }
}

export function createCardPurchases(db: Database): CardPurchases {
  return new DrizzleCardPurchases(db);
}
