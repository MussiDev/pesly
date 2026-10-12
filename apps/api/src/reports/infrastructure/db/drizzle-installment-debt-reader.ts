import { addMonths } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import { assertIssuedScope, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { NetWorthWindow } from '../../application/ports/net-worth-sources';
import type { InstallmentDebtRow } from '../../domain/installment-debt';

interface DebtRow extends Record<string, unknown> {
  period: string;
  closing_date: string | null;
  closing_day: number;
  due_day: number;
  purchase_month: string;
  currency: string;
  total: string;
}

/**
 * Installments of purchases made by the last point, from one month before the first point,
 * grouped by statement; the domain function decides, per point, which ones are still pending.
 */
export class DrizzleInstallmentDebtReader {
  constructor(private readonly db: Database) {}

  async installmentDebtRows(
    scope: AccessScope,
    window: NetWorthWindow,
  ): Promise<InstallmentDebtRow[]> {
    assertIssuedScope(scope);
    const first = window.points[0];
    const last = window.points[window.points.length - 1];
    if (first === undefined || last === undefined) return [];
    const result = await this.db.execute<DebtRow>(sql`
      select i.period, cs.closing_date::text as closing_date, c.closing_day::int as closing_day,
             c.due_day::int as due_day, to_char(p.purchased_on, 'YYYY-MM') as purchase_month,
             p.currency, sum(i.amount)::text as total
      from installments i
      join installment_purchases p on p.id = i.purchase_id and p.owner_id = i.owner_id
      join credit_cards c on c.id = p.card_id and c.owner_id = p.owner_id
      left join credit_card_statements cs
        on cs.card_id = c.id and cs.owner_id = c.owner_id and cs.period = i.period
      where i.owner_id = ${scope.userId}::uuid
        and p.purchased_on <= ${last.date}::date
        and i.period >= ${addMonths(first.month, -1)}::text
      group by i.period, cs.closing_date, c.closing_day, c.due_day,
               to_char(p.purchased_on, 'YYYY-MM'), p.currency`);
    return result.rows.map((row) => ({
      period: row.period,
      closingDate: row.closing_date,
      closingDay: row.closing_day,
      dueDay: row.due_day,
      purchaseMonth: row.purchase_month,
      currency: row.currency,
      sum: BigInt(row.total),
    }));
  }
}
