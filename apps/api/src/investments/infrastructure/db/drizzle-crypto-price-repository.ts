import { sql } from 'drizzle-orm';
import type { CryptoPriceRepository } from '../../application/price-ports';
import type { PriceQuote } from '../../domain/crypto-price';
import type { InvestmentsDb } from './schema';

/** Same pattern as the market table's symbol check: a symbol outside it can never be stored. */
const MARKET_SYMBOL_PATTERN = '^[a-z0-9._-]{1,20}$';

/**
 * Worker side only. It acts on the holdings of every user at once, by design: the price job is not
 * a request and has no owner scope, so it is never exported through the module barrel.
 */
export class DrizzleCryptoPriceRepository implements CryptoPriceRepository {
  constructor(private readonly db: InvestmentsDb) {}

  async symbolsToPrice(limit: number): Promise<string[]> {
    // Raw SQL: a GROUP BY over an expression with a LEFT JOIN and NULLS FIRST ordering. Ordering by
    // the stored market time (not by the holdings' prices) keeps manual prices from starving others.
    const result = await this.db.execute<{ symbol: string }>(sql`
      SELECT lower(h.ticker) AS symbol
      FROM holdings h
      LEFT JOIN crypto_market_prices m ON m.symbol = lower(h.ticker)
      WHERE h.instrument_type = 'crypto'
        AND lower(h.ticker) ~ ${MARKET_SYMBOL_PATTERN}
      GROUP BY lower(h.ticker), m.priced_at
      ORDER BY m.priced_at NULLS FIRST, symbol
      LIMIT ${limit}
    `);
    return result.rows.map((row) => row.symbol);
  }

  async storeAndApply(
    quotes: readonly PriceQuote[],
    requestedAt: Date,
  ): Promise<{ markets: number; holdings: number }> {
    // One row per symbol: a repeated one would make the upsert hit the same row twice and abort.
    // Sorted so two overlapping workers lock the market rows in the same order and cannot deadlock.
    const bySymbol = new Map(
      [...new Map(quotes.map((quote) => [quote.symbol, quote.unitPrice]))].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    if (bySymbol.size === 0) return { markets: 0, holdings: 0 };
    const pricedAt = requestedAt.toISOString();

    return this.db.transaction(async (tx) => {
      // Raw SQL: the conditional upsert over a multi-row VALUES list with bound `bigint` casts is
      // not expressible in the query builder. The WHERE keeps a stored price that is not older.
      const stored = await tx.execute(sql`
        INSERT INTO crypto_market_prices (symbol, unit_price, priced_at)
        VALUES ${sql.join(
          [...bySymbol].map(
            ([symbol, unitPrice]) =>
              sql`(${symbol}, ${unitPrice.toString()}::bigint, ${pricedAt}::timestamptz)`,
          ),
          sql`, `,
        )}
        ON CONFLICT (symbol) DO UPDATE
          SET unit_price = EXCLUDED.unit_price, priced_at = EXCLUDED.priced_at
          WHERE crypto_market_prices.priced_at < EXCLUDED.priced_at
      `);

      // Raw SQL: UPDATE ... FROM is not available in the query builder. It reads the stored market
      // table, not only the rows above, so a holding added later or whose price was cleared is
      // priced too. `price_source` is checked on the row at update time: a manual price committed
      // while this statement waits on the row lock is kept. Both relations carry `unit_price` and
      // `priced_at`, so every column is qualified.
      const applied = await tx.execute(sql`
        UPDATE holdings h
        SET unit_price = m.unit_price,
            price_source = 'automatic',
            priced_at = m.priced_at,
            updated_at = now()
        FROM crypto_market_prices m
        WHERE h.instrument_type = 'crypto'
          AND h.valuation_currency = 'USD'
          AND lower(h.ticker) = m.symbol
          AND m.symbol IN (${sql.join(
            [...bySymbol.keys()].map((symbol) => sql`${symbol}`),
            sql`, `,
          )})
          AND h.price_source IS DISTINCT FROM 'manual'
          AND (h.priced_at IS NULL OR h.priced_at < m.priced_at)
      `);

      return { markets: stored.rowCount ?? 0, holdings: applied.rowCount ?? 0 };
    });
  }
}
