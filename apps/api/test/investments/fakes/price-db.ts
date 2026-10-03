import type pg from 'pg';

/** Raw inserts for the price and snapshot repository tests, so the schema is the only fixture. */

export async function insertPortfolio(
  pool: pg.Pool,
  ownerId: string,
  options: { name?: string; createdAt?: Date } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into portfolios (owner_id, name, created_at)
     values ($1, $2, coalesce($3::timestamptz, now())) returning id`,
    [ownerId, options.name ?? 'Balanz', options.createdAt?.toISOString() ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error('portfolio insert returned no row');
  return row.id;
}

export interface HoldingSeed {
  portfolioId: string;
  ownerId: string;
  ticker: string;
  type?: string;
  currency?: string;
  /** Scaled by 10^8. */
  quantity?: bigint;
  price?: { unitPrice: bigint; source: 'import' | 'manual' | 'automatic'; pricedAt: Date };
}

export async function insertHolding(pool: pg.Pool, seed: HoldingSeed): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into holdings (portfolio_id, owner_id, ticker, instrument_name, instrument_type, quantity,
                           valuation_currency, unit_price, price_source, priced_at)
     values ($1, $2, $3, $3, $4, $5::bigint, $6, $7::bigint, $8, $9::timestamptz) returning id`,
    [
      seed.portfolioId,
      seed.ownerId,
      seed.ticker,
      seed.type ?? 'crypto',
      (seed.quantity ?? 100_000_000n).toString(),
      seed.currency ?? 'USD',
      seed.price?.unitPrice.toString() ?? null,
      seed.price?.source ?? null,
      seed.price?.pricedAt.toISOString() ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('holding insert returned no row');
  return row.id;
}

export interface StoredHoldingPrice {
  unitPrice: bigint | null;
  source: string | null;
  pricedAt: Date | null;
  updatedAt: Date;
}

export async function holdingPrice(pool: pg.Pool, id: string): Promise<StoredHoldingPrice> {
  const result = await pool.query<{
    unit_price: string | null;
    price_source: string | null;
    priced_at: Date | null;
    updated_at: Date;
  }>('select unit_price, price_source, priced_at, updated_at from holdings where id = $1', [id]);
  const row = result.rows[0];
  if (!row) throw new Error(`holding ${id} not found`);
  return {
    unitPrice: row.unit_price === null ? null : BigInt(row.unit_price),
    source: row.price_source,
    pricedAt: row.priced_at,
    updatedAt: row.updated_at,
  };
}

/** The SQLSTATE of a failing statement, or undefined when it succeeds. */
export async function sqlState(
  pool: pg.Pool,
  statement: string,
  values: unknown[] = [],
): Promise<string | undefined> {
  try {
    await pool.query(statement, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
