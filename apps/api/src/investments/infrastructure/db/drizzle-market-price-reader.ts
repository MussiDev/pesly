import { inArray } from 'drizzle-orm';
import { cryptoMarketPrices, type InvestmentsDb } from './schema';

export interface StoredMarketPrice {
  /** US cents. */
  unitPrice: bigint;
  pricedAt: Date;
}

/**
 * API side: a read-only lookup of the stored market prices. It lives apart from the worker
 * repository so the API process never imports the code that writes them, and it touches no user data.
 */
export class DrizzleMarketPriceReader {
  constructor(private readonly db: InvestmentsDb) {}

  /** Stored prices by lowercase symbol; one query, none for an empty list. */
  async findMany(symbols: readonly string[]): Promise<Map<string, StoredMarketPrice>> {
    if (symbols.length === 0) return new Map();
    const rows = await this.db
      .select({
        symbol: cryptoMarketPrices.symbol,
        unitPrice: cryptoMarketPrices.unitPrice,
        pricedAt: cryptoMarketPrices.pricedAt,
      })
      .from(cryptoMarketPrices)
      .where(inArray(cryptoMarketPrices.symbol, [...symbols]));
    return new Map(
      rows.map((row) => [row.symbol, { unitPrice: row.unitPrice, pricedAt: row.pricedAt }]),
    );
  }
}
