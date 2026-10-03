import { and, asc, eq, exists, gt, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import type {
  SnapshotCandidate,
  SnapshotHolding,
  SnapshotRepository,
  SnapshotRow,
} from '../../application/price-ports';
// Deliberate read-only import across modules: the user's stored time zone decides the snapshot day.
import { users } from '../../../identity/infrastructure/db/schema';
import { holdings, portfolios, portfolioValueSnapshots, type InvestmentsDb } from './schema';

/**
 * Worker side only. It reads the portfolios of every user at once, by design: the snapshot job is
 * not a request and has no owner scope, so it is never exported through the module barrel.
 */
export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: InvestmentsDb) {}

  async zonesInUse(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ zone: users.timeZone })
      .from(users)
      .innerJoin(portfolios, eq(portfolios.ownerId, users.id));
    return rows.map((row) => row.zone);
  }

  async portfoliosToSnapshot(
    zone: string,
    date: string,
    afterId: string | null,
    limit: number,
  ): Promise<SnapshotCandidate[]> {
    const page = await this.db
      .select({
        portfolioId: portfolios.id,
        ownerId: portfolios.ownerId,
        createdAt: portfolios.createdAt,
      })
      .from(portfolios)
      .innerJoin(users, eq(users.id, portfolios.ownerId))
      .where(
        and(
          eq(users.timeZone, zone),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(holdings)
              .where(and(eq(holdings.portfolioId, portfolios.id), isNotNull(holdings.unitPrice))),
          ),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(portfolioValueSnapshots)
              .where(
                and(
                  eq(portfolioValueSnapshots.portfolioId, portfolios.id),
                  eq(portfolioValueSnapshots.snapshotDate, date),
                ),
              ),
          ),
          afterId === null ? undefined : gt(portfolios.id, afterId),
        ),
      )
      .orderBy(asc(portfolios.id))
      .limit(limit);
    if (page.length === 0) return [];

    // A second query keeps every holding of a portfolio together whatever the page limit is.
    const priced = await this.db
      .select({
        portfolioId: holdings.portfolioId,
        quantity: holdings.quantity,
        unitPrice: holdings.unitPrice,
        valuationCurrency: holdings.valuationCurrency,
      })
      .from(holdings)
      .where(
        and(
          inArray(
            holdings.portfolioId,
            page.map((row) => row.portfolioId),
          ),
          isNotNull(holdings.unitPrice),
        ),
      );

    const byPortfolio = new Map<string, SnapshotHolding[]>();
    for (const { portfolioId, unitPrice, ...rest } of priced) {
      // The price columns are all null or all set, so the filter above makes this a type guard.
      if (unitPrice === null) continue;
      const list = byPortfolio.get(portfolioId) ?? [];
      list.push({ ...rest, unitPrice });
      byPortfolio.set(portfolioId, list);
    }
    return page.map((row) => ({ ...row, holdings: byPortfolio.get(row.portfolioId) ?? [] }));
  }

  async save(rows: readonly SnapshotRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    // One multi-row insert is one atomic statement: every currency of a day is written or none.
    // Only a conflict on the primary key is the idempotent case; any other violation propagates.
    const inserted = await this.db
      .insert(portfolioValueSnapshots)
      .values(
        rows.map((row) => ({
          portfolioId: row.portfolioId,
          ownerId: row.ownerId,
          snapshotDate: row.date,
          currency: row.currency,
          totalValue: row.totalValue,
          takenAt: row.takenAt,
        })),
      )
      .onConflictDoNothing({
        target: [
          portfolioValueSnapshots.portfolioId,
          portfolioValueSnapshots.snapshotDate,
          portfolioValueSnapshots.currency,
        ],
      })
      .returning({ portfolioId: portfolioValueSnapshots.portfolioId });
    return inserted.length;
  }
}
