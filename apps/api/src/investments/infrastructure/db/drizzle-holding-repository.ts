import type { PriceSource } from '@pesly/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Holding } from '../../domain/holding';
import type {
  HoldingDraft,
  HoldingRepository,
  HoldingUpdate,
  PriceWriteGuard,
} from '../../application/ports';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { holdings, portfolios, type InvestmentsDb } from './schema';

const columns = {
  id: holdings.id,
  portfolioId: holdings.portfolioId,
  ticker: holdings.ticker,
  instrumentName: holdings.instrumentName,
  instrumentType: holdings.instrumentType,
  quantity: holdings.quantity,
  valuationCurrency: holdings.valuationCurrency,
  totalCost: holdings.totalCost,
  unitPrice: holdings.unitPrice,
  priceSource: holdings.priceSource,
  pricedAt: holdings.pricedAt,
};

type HoldingRow = Pick<typeof holdings.$inferSelect, keyof typeof columns>;

/** The check constraint keeps the three price columns all null or all set, so one test suffices. */
function toHolding(row: HoldingRow): Holding {
  const { unitPrice, priceSource, pricedAt, ...rest } = row;
  const price =
    unitPrice !== null && priceSource !== null && pricedAt !== null
      ? { unitPrice, source: priceSource, pricedAt }
      : null;
  return { ...rest, price };
}

function toHoldings(rows: HoldingRow[]): Holding[] {
  return rows.map(toHolding);
}

function priceColumns(price: HoldingUpdate['price']) {
  return {
    unitPrice: price?.unitPrice ?? null,
    priceSource: price?.source ?? null,
    pricedAt: price?.pricedAt ?? null,
  };
}

/** The scoped clause every statement uses: this row, and only if the scope covers it. */
function scopedRow(scope: AccessScope, id: string) {
  return and(eq(holdings.id, id), scopedTo(scope, { owner: holdings.ownerId }));
}

/** Stable order for lists: ticker ignoring case, the id breaks ties. */
const byTicker = [asc(sql`lower(${holdings.ticker})`), asc(holdings.id)] as const;

export class DrizzleHoldingRepository implements HoldingRepository {
  constructor(private readonly db: InvestmentsDb) {}

  async listByOwner(scope: AccessScope): Promise<Holding[]> {
    return toHoldings(
      await this.db
        .select(columns)
        .from(holdings)
        .where(scopedTo(scope, { owner: holdings.ownerId }))
        .orderBy(...byTicker),
    );
  }

  async listByPortfolio(scope: AccessScope, portfolioId: string): Promise<Holding[]> {
    return toHoldings(
      await this.db
        .select(columns)
        .from(holdings)
        .where(
          and(eq(holdings.portfolioId, portfolioId), scopedTo(scope, { owner: holdings.ownerId })),
        )
        .orderBy(...byTicker),
    );
  }

  async findById(scope: AccessScope, id: string): Promise<Holding | null> {
    const [row] = await this.db.select(columns).from(holdings).where(scopedRow(scope, id)).limit(1);
    return row === undefined ? null : toHolding(row);
  }

  async findForUpdate(scope: AccessScope<'write'>, id: string): Promise<Holding | null> {
    const [row] = await this.db
      .select(columns)
      .from(holdings)
      .where(scopedRow(scope, id))
      .limit(1)
      .for('update');
    return row === undefined ? null : toHolding(row);
  }

  async findByTicker(
    scope: AccessScope<'write'>,
    portfolioId: string,
    ticker: string,
  ): Promise<Holding | null> {
    const [row] = await this.db
      .select(columns)
      .from(holdings)
      .where(
        and(
          eq(holdings.portfolioId, portfolioId),
          sql`lower(${holdings.ticker}) = lower(${ticker})`,
          scopedTo(scope, { owner: holdings.ownerId }),
        ),
      )
      .limit(1);
    return row === undefined ? null : toHolding(row);
  }

  /**
   * One INSERT ... SELECT from the scoped portfolio: the owner comes from the portfolio row it
   * selects, so a portfolio outside the scope inserts nothing and answers null.
   */
  async insert(
    scope: AccessScope<'write'>,
    portfolioId: string,
    draft: HoldingDraft,
  ): Promise<Holding | null> {
    // Drizzle's insert().select() matches columns by alias; keep the aliases in sync with the schema columns.
    const [row] = await this.db
      .insert(holdings)
      .select((qb) =>
        qb
          .select({
            id: sql<string>`gen_random_uuid()`.as('id'),
            portfolioId: sql<string>`${portfolios.id}`.as('portfolio_id'),
            ownerId: sql<string>`${portfolios.ownerId}`.as('owner_id'),
            ticker: sql<string>`${draft.ticker}`.as('ticker'),
            instrumentName: sql<string>`${draft.instrumentName}`.as('instrument_name'),
            instrumentType: sql<string>`${draft.instrumentType}`.as('instrument_type'),
            quantity: sql<bigint>`${draft.quantity.toString()}::bigint`.as('quantity'),
            valuationCurrency: sql<string>`${draft.valuationCurrency}`.as('valuation_currency'),
            totalCost: sql<bigint | null>`${draft.totalCost?.toString() ?? null}::bigint`.as(
              'total_cost',
            ),
            unitPrice: sql<bigint | null>`null::bigint`.as('unit_price'),
            priceSource: sql<string | null>`null::text`.as('price_source'),
            pricedAt: sql<Date | null>`null::timestamptz`.as('priced_at'),
            createdAt: sql<Date>`now()`.as('created_at'),
            updatedAt: sql<Date>`now()`.as('updated_at'),
          })
          .from(portfolios)
          .where(
            and(eq(portfolios.id, portfolioId), scopedTo(scope, { owner: portfolios.ownerId })),
          ),
      )
      .returning(columns);
    return row === undefined ? null : toHolding(row);
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    fields: HoldingUpdate,
  ): Promise<Holding | null> {
    const [row] = await this.db
      .update(holdings)
      .set({
        quantity: fields.quantity,
        totalCost: fields.totalCost,
        valuationCurrency: fields.valuationCurrency,
        ...priceColumns(fields.price),
        updatedAt: sql`now()`,
      })
      .where(scopedRow(scope, id))
      .returning(columns);
    return row === undefined ? null : toHolding(row);
  }

  async setPrice(
    scope: AccessScope<'write'>,
    id: string,
    unitPrice: bigint,
    source: PriceSource,
    pricedAt: Date,
    guard?: PriceWriteGuard,
  ): Promise<Holding | null> {
    const [row] = await this.db
      .update(holdings)
      .set({ unitPrice, priceSource: source, pricedAt, updatedAt: sql`now()` })
      .where(
        guard === undefined
          ? scopedRow(scope, id)
          : and(
              scopedRow(scope, id),
              eq(holdings.instrumentType, guard.instrumentType),
              sql`lower(${holdings.ticker}) = ${guard.ticker}`,
            ),
      )
      .returning(columns);
    return row === undefined ? null : toHolding(row);
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(holdings)
      .where(scopedRow(scope, id))
      .returning({ id: holdings.id });
    return rows.length === 1;
  }
}
