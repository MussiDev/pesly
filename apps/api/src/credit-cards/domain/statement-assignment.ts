import { assignStatement } from '@pesly/shared';

export { assignStatement };

export interface DailyPurchase {
  /** Calendar day in the user's time zone, `YYYY-MM-DD`. */
  day: string;
  currency: 'ARS' | 'USD';
  /** Sum of the day's purchases, in minor units. */
  amount: bigint;
}

export interface StatementTotals {
  ARS: bigint;
  USD: bigint;
}

interface Closing {
  id: string;
  closingDate: string;
}

/** Purchases added up per statement id and currency; days without a statement are ignored. */
export function statementTotals(
  statements: readonly Closing[],
  dailyPurchases: readonly DailyPurchase[],
): Map<string, StatementTotals> {
  const totals = new Map<string, StatementTotals>(
    statements.map((statement) => [statement.id, { ARS: 0n, USD: 0n }]),
  );
  for (const purchase of dailyPurchases) {
    const statement = assignStatement(purchase.day, statements);
    const total = statement && totals.get(statement.id);
    if (total) total[purchase.currency] += purchase.amount;
  }
  return totals;
}
