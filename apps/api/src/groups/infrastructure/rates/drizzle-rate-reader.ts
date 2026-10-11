import type { RateType } from '@pesly/shared';
import { DrizzleRateLookup } from '../../../movements/infrastructure/db/drizzle-rate-lookup';
import type { Database } from '../../../shared/db/client';
import type { RateReader } from '../../application/ports/rate-reader';

/** Stored values only: the movements rate lookup reads one table and never calls a provider. */
export class DrizzleRateReader implements RateReader {
  private readonly lookup: DrizzleRateLookup;

  constructor(db: Database) {
    this.lookup = new DrizzleRateLookup(db);
  }

  latestSell(rateType: RateType): Promise<{ sell: bigint } | null> {
    return this.lookup.latestSell(rateType);
  }
}
