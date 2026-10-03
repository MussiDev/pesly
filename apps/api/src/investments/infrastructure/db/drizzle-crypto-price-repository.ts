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
    // Raw SQL: a GROUP BY over an expression with a LEFT JOIN, window functions and random order.
    // Ordering by the stored market time (not by the holdings' prices) keeps manual prices from
    // starving others. A ticker the provider never answers (junk typed by any user) never gets a
    // stored price, so "never priced first" would let such tickers fill every request and starve
    // the real ones. Half of the slots go to the oldest priced symbols; the never priced ones are
    // drawn at random for the rest, so each is tried eventually and junk takes at most half. A
    // group that cannot fill its share leaves the slots to the other one.
    const result = await this.db.execute<{ symbol: string }>(sql`
      WITH candidates AS (
        SELECT lower(h.ticker) AS symbol, m.priced_at
        FROM holdings h
        LEFT JOIN crypto_market_prices m ON m.symbol = lower(h.ticker)
        WHERE h.instrument_type = 'crypto'
          AND lower(h.ticker) ~ ${MARKET_SYMBOL_PATTERN}
        GROUP BY lower(h.ticker), m.priced_at
      ),
      priced AS (
        SELECT symbol, row_number() OVER (ORDER BY priced_at, symbol) AS rn
        FROM candidates WHERE priced_at IS NOT NULL
      ),
      fresh AS (
        SELECT symbol, row_number() OVER (ORDER BY random()) AS rn
        FROM candidates WHERE priced_at IS NULL
      ),
      quota AS (
        SELECT least(
          (SELECT count(*) FROM priced),
          greatest((${limit}::int + 1) / 2, ${limit}::int - (SELECT count(*) FROM fresh))
        ) AS priced_slots
      )
      SELECT symbol FROM (
        SELECT symbol, 0 AS grp, rn FROM priced WHERE rn <= (SELECT priced_slots FROM quota)
        UNION ALL
        SELECT symbol, 1 AS grp, rn FROM fresh WHERE rn <= ${limit}::int - (SELECT priced_slots FROM quota)
      ) picked
      ORDER BY grp, rn
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
