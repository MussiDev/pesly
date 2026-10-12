import { sql } from 'drizzle-orm';
import type { RateType } from '@pesly/shared';
import type { Database } from '../../../shared/db/client';
import type { NetWorthRateReader } from '../../application/ports/net-worth-rate-reader';

interface RateRow extends Record<string, unknown> {
  point_date: string;
  sell: string | null;
}

/** The stored rates are global, not user data: nothing here is scoped by owner. */
export class DrizzleNetWorthRateReader implements NetWorthRateReader {
  constructor(private readonly db: Database) {}

  async sellRates(
    rateType: RateType,
    dates: readonly string[],
    today: string,
  ): Promise<Map<string, bigint | null>> {
    const rates = new Map<string, bigint | null>();
    for (const date of dates) rates.set(date, null);
    const past = dates.filter((date) => date < today);
    const current = dates.filter((date) => date >= today);

    if (past.length > 0) {
      const list = sql`array[${sql.join(
        past.map((date) => sql`${date}`),
        sql`, `,
      )}]::date[]`;
      const result = await this.db.execute<RateRow>(sql`
        select d.point_date::text as point_date, h.sell::text as sell
        from unnest(${list}) as d(point_date)
        left join lateral (
          select sell from exchange_rate_history
          where rate_type = ${rateType} and rate_date <= d.point_date
          order by rate_date desc limit 1
        ) h on true`);
      for (const row of result.rows) {
        rates.set(row.point_date, row.sell === null ? null : BigInt(row.sell));
      }
    }

    if (current.length > 0) {
      const result = await this.db.execute<{ sell: string }>(
        sql`select sell::text as sell from exchange_rates where rate_type = ${rateType}`,
      );
      const stored = result.rows[0];
      for (const date of current) rates.set(date, stored ? BigInt(stored.sell) : null);
    }
    return rates;
  }
}
