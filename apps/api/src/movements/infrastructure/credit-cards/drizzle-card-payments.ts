import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CardPayments } from '../../../credit-cards/application/ports/card-payments';
import type { CreditCard } from '../../../credit-cards/domain/credit-card';
import type { StatementTotals } from '../../../credit-cards/domain/statement-assignment';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

/**
 * What the card received is the transfers whose destination is one of its linked accounts, summed
 * per destination (spec D2). Scoped in the same statement: a scope that is not the owner's matches
 * no rows.
 */
class DrizzleCardPayments implements CardPayments {
  constructor(private readonly db: Database) {}

  async receivedByCard(scope: AccessScope, card: CreditCard): Promise<StatementTotals> {
    const rows = await this.db
      .select({
        destinationAccountId: movements.destinationAccountId,
        // `sum(bigint)` is numeric: cast to text so the exact value reaches BigInt.
        total: sql<string>`sum(${movements.amount})::text`,
      })
      .from(movements)
      .where(
        and(
          scopedTo(scope, { owner: movements.ownerId }),
          eq(movements.type, 'transfer'),
          inArray(movements.destinationAccountId, [card.arsAccountId, card.usdAccountId]),
        ),
      )
      .groupBy(movements.destinationAccountId);
    const received: StatementTotals = { ARS: 0n, USD: 0n };
    for (const row of rows) {
      if (row.destinationAccountId === card.arsAccountId) received.ARS = BigInt(row.total);
      if (row.destinationAccountId === card.usdAccountId) received.USD = BigInt(row.total);
    }
    return received;
  }
}

export function createCardPayments(db: Database): CardPayments {
  return new DrizzleCardPayments(db);
}
