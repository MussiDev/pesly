import { sql } from 'drizzle-orm';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { InvestmentValues, NetWorthPoint } from '../../application/ports/net-worth-sources';
import type { CurrencyAmounts } from '../../domain/installment-debt';
import { assertCurrency, emptyAmounts } from './bucketed-sums';

interface InvestmentRow extends Record<string, unknown> {
  kind: 'value' | 'incomplete';
  point_date: string;
  currency: string | null;
  total: string | null;
}

/** `array[$1, $2]::type[]`: one bound parameter per element, so nothing is spliced into the SQL. */
function arrayOf(values: readonly string[], type: 'date' | 'timestamptz') {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(type)}[]`;
}

/** The latest daily snapshot day on or before each point, per portfolio, all its currency rows summed. */
export class DrizzleInvestmentReader {
  constructor(private readonly db: Database) {}

  async investmentValues(
    scope: AccessScope,
    points: readonly NetWorthPoint[],
  ): Promise<InvestmentValues> {
    assertIssuedScope(scope);
    const values = new Map<string, CurrencyAmounts>();
    const incompleteDates = new Set<string>();
    if (points.length === 0) return { values, incompleteDates };
    const owner = scope.userId;
    const dates = arrayOf(
      points.map((point) => point.date),
      'date',
    );
    const ends = arrayOf(
      points.map((point) => point.end.toISOString()),
      'timestamptz',
    );

    const result = await this.db.execute<InvestmentRow>(sql`
      select 'value' as kind, d.point_date::text as point_date, snap.currency,
             sum(snap.total_value)::text as total
      from unnest(${dates}) as d(point_date)
      join portfolios p on p.owner_id = ${owner}::uuid
      cross join lateral (
        select s.currency, s.total_value
        from portfolio_value_snapshots s
        where s.portfolio_id = p.id and s.owner_id = p.owner_id
          and s.snapshot_date = (
            select max(l.snapshot_date) from portfolio_value_snapshots l
            where l.portfolio_id = p.id and l.owner_id = p.owner_id and l.snapshot_date <= d.point_date
          )
      ) snap
      group by d.point_date, snap.currency
      union all
      select 'incomplete', d.point_date::text, null, null
      from unnest(${dates}, ${ends}) as d(point_date, point_end)
      join portfolios p on p.owner_id = ${owner}::uuid and p.created_at < d.point_end
      where not exists (
        select 1 from portfolio_value_snapshots s
        where s.portfolio_id = p.id and s.owner_id = p.owner_id and s.snapshot_date <= d.point_date
      )
      group by d.point_date`);

    for (const row of result.rows) {
      if (row.kind === 'incomplete') {
        incompleteDates.add(row.point_date);
        continue;
      }
      const amounts = values.get(row.point_date) ?? emptyAmounts();
      amounts[assertCurrency(row.currency ?? '')] += BigInt(row.total ?? '0');
      values.set(row.point_date, amounts);
    }
    return { values, incompleteDates };
  }
}
