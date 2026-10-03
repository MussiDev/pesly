import { lt } from 'drizzle-orm';
import type { PriceFailureLog, PriceFailureRecord } from '../../application/price-ports';
import { cryptoPriceRefreshFailures, type InvestmentsDb } from './schema';

const DETAIL_MAX_CHARS = 200;
const NUL = String.fromCharCode(0);

/** Counts code points like the database `char_length` check, so a failure record never throws. */
function truncated(detail: string | undefined): string | null {
  if (detail === undefined) return null;
  // PostgreSQL text cannot hold NUL, so it is dropped rather than failing the record.
  return Array.from(detail.replaceAll(NUL, '')).slice(0, DETAIL_MAX_CHARS).join('');
}

const STATUS_CODE_MIN = 100;
const STATUS_CODE_MAX = 599;

/** The column check is 100-599; anything else is stored as unknown instead of throwing. */
function validStatusCode(statusCode: number | undefined): number | null {
  if (statusCode === undefined) return null;
  const inRange = statusCode >= STATUS_CODE_MIN && statusCode <= STATUS_CODE_MAX;
  return inRange && statusCode % 1 === 0 ? statusCode : null;
}

export class DrizzlePriceFailureLog implements PriceFailureLog {
  constructor(private readonly db: InvestmentsDb) {}

  async record(failure: PriceFailureRecord): Promise<void> {
    await this.db.insert(cryptoPriceRefreshFailures).values({
      failedAt: failure.at,
      code: failure.code,
      statusCode: validStatusCode(failure.statusCode),
      detail: truncated(failure.detail),
    });
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(cryptoPriceRefreshFailures)
      .where(lt(cryptoPriceRefreshFailures.failedAt, cutoff))
      .returning({ id: cryptoPriceRefreshFailures.id });
    return deleted.length;
  }
}
