import { dateInTimeZone } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import type { RateRepository } from '../../application/ports/rate-repository';
import type { RateQuote, StoredRate } from '../../domain/rate-quote';
import type { Database } from '../../../shared/db/client';
import { exchangeRateHistory, exchangeRates } from './schema';

/** The history is dated by the Argentina calendar day of the fetch (the product's market day). */
const HISTORY_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class DrizzleRateRepository implements RateRepository {
  constructor(private readonly db: Database) {}

  async replaceAll(quotes: readonly RateQuote[], fetchedAt: Date): Promise<void> {
    if (quotes.length === 0) return;
    const rateDate = dateInTimeZone(fetchedAt, HISTORY_TIME_ZONE);
    // One transaction, so readers see the old set or the new set and a failure of either table
    // keeps the old one.
    await this.db.transaction(async (tx) => {
      await tx
        .insert(exchangeRates)
        .values(quotes.map((quote) => ({ ...quote, fetchedAt })))
        .onConflictDoUpdate({
          target: exchangeRates.rateType,
          set: {
            buy: sql`excluded.buy`,
            sell: sql`excluded.sell`,
            providerUpdatedAt: sql`excluded.provider_updated_at`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      await tx
        .insert(exchangeRateHistory)
        .values(
          quotes.map((quote) => ({
            rateType: quote.rateType,
            rateDate,
            buy: quote.buy,
            sell: quote.sell,
            recordedAt: fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [exchangeRateHistory.rateType, exchangeRateHistory.rateDate],
          set: {
            buy: sql`excluded.buy`,
            sell: sql`excluded.sell`,
            recordedAt: sql`excluded.recorded_at`,
          },
        });
    });
  }

  async findAll(): Promise<StoredRate[]> {
    return this.db.select().from(exchangeRates);
  }
}
