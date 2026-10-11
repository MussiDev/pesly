import { and, eq, ne } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type {
  AutomaticDebitKey,
  AutomaticDebitLog,
  AutomaticDebitSettlement,
  ClaimResult,
} from '../../application/ports/automatic-debit-log';
import { settledKey } from '../../domain/automatic-debit';
import { cardAutomaticDebits } from './schema';

/** Thrown inside the claim transaction to roll it back without a row; never leaves this file. */
class ReleasedClaim extends Error {}

const sameKey = (scope: AccessScope<'write'>, key: AutomaticDebitKey) =>
  and(
    eq(cardAutomaticDebits.cardId, key.cardId),
    eq(cardAutomaticDebits.period, key.period),
    eq(cardAutomaticDebits.currency, key.currency),
    eq(cardAutomaticDebits.ownerId, scope.userId),
  );

export class DrizzleAutomaticDebitLog implements AutomaticDebitLog {
  constructor(private readonly db: Database) {}

  async settledKeys(scope: AccessScope<'write'>, cardId: string): Promise<ReadonlySet<string>> {
    const rows = await this.db
      .select({ period: cardAutomaticDebits.period, currency: cardAutomaticDebits.currency })
      .from(cardAutomaticDebits)
      .where(
        and(
          eq(cardAutomaticDebits.cardId, cardId),
          eq(cardAutomaticDebits.ownerId, scope.userId),
          ne(cardAutomaticDebits.status, 'pending'),
        ),
      );
    return new Set(rows.map((row) => settledKey(row.period, row.currency)));
  }

  async withClaim(
    scope: AccessScope<'write'>,
    key: AutomaticDebitKey,
    settle: () => Promise<AutomaticDebitSettlement | null>,
  ): Promise<ClaimResult> {
    try {
      return await this.db.transaction(async (tx) => {
        // A concurrent claim of the same key blocks here on the unique index until the first
        // transaction ends, then sees its settled row below (spec NFR-03).
        await tx
          .insert(cardAutomaticDebits)
          .values({
            cardId: key.cardId,
            ownerId: scope.userId,
            period: key.period,
            currency: key.currency,
            status: 'pending',
          })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ status: cardAutomaticDebits.status })
          .from(cardAutomaticDebits)
          .where(sameKey(scope, key))
          .for('update');
        if (!row || row.status !== 'pending') return { claimed: false };
        const settlement = await settle();
        if (settlement === null) throw new ReleasedClaim();
        await tx
          .update(cardAutomaticDebits)
          .set({
            status: settlement.status,
            reason: settlement.status === 'skipped' ? settlement.reason : null,
            movementId: settlement.status === 'recorded' ? settlement.movementId : null,
            updatedAt: new Date(),
          })
          .where(sameKey(scope, key));
        return { claimed: true, settlement };
      });
    } catch (error) {
      if (error instanceof ReleasedClaim) return { claimed: true, settlement: null };
      throw error;
    }
  }
}
