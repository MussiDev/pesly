import { statementDatesFor, type AccountCurrency } from '@pesly/shared';

export type CurrencyAmounts = Record<AccountCurrency, bigint>;

export interface InstallmentDebtRow {
  /** The statement period, `YYYY-MM`. */
  period: string;
  /** The stored closing date of the statement, or null when the statement does not exist yet. */
  closingDate: string | null;
  closingDay: number;
  dueDay: number;
  /** The month of the purchase, `YYYY-MM`. */
  purchaseMonth: string;
  currency: string;
  sum: bigint;
}

export interface DebtPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `YYYY-MM`. */
  month: string;
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function emptyAmounts(): CurrencyAmounts {
  return { ARS: 0n, USD: 0n };
}

function isCurrency(value: string): value is AccountCurrency {
  return value === 'ARS' || value === 'USD';
}

/**
 * The pending installment debt at each point: the installments of purchases made by the point's
 * month whose statement closes after the point's date. A missing statement derives its closing
 * date from the card, and the statements are read as stored now.
 */
export function installmentDebt(
  rows: readonly InstallmentDebtRow[],
  points: readonly DebtPoint[],
): Map<string, CurrencyAmounts> {
  const closings = rows.map((row) => {
    if (!PERIOD.test(row.period)) throw new Error(`Invalid installment period "${row.period}"`);
    if (!isCurrency(row.currency))
      throw new Error(`Invalid installment currency "${row.currency}"`);
    const closing =
      row.closingDate ?? statementDatesFor(row.period, row.closingDay, row.dueDay).closingDate;
    return { closing, purchaseMonth: row.purchaseMonth, currency: row.currency, sum: row.sum };
  });

  const debt = new Map<string, CurrencyAmounts>();
  for (const point of points) {
    const amounts = emptyAmounts();
    for (const item of closings) {
      if (item.purchaseMonth <= point.month && item.closing > point.date) {
        amounts[item.currency] += item.sum;
      }
    }
    debt.set(point.date, amounts);
  }
  return debt;
}
