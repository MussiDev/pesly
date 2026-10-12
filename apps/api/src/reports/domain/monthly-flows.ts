export interface MonthAmount {
  /** `YYYY-MM` */
  month: string;
  amount: bigint;
}

export interface MonthlyFlow {
  month: string;
  income: bigint;
  expenses: bigint;
}

/**
 * One entry per listed month, in the given order, with 0 for a month that holds no flow. Amounts
 * of any other month are ignored: the caller reads a wider window than the range on purpose.
 */
export function foldMonthlyFlows(
  months: readonly string[],
  incomes: readonly MonthAmount[],
  expenses: readonly MonthAmount[],
): MonthlyFlow[] {
  if (months.length === 0) throw new RangeError('A report needs at least one month');
  const byMonth = new Map<string, MonthlyFlow>();
  for (const month of months) byMonth.set(month, { month, income: 0n, expenses: 0n });
  for (const { month, amount } of incomes) {
    const entry = byMonth.get(month);
    if (entry) entry.income += amount;
  }
  for (const { month, amount } of expenses) {
    const entry = byMonth.get(month);
    if (entry) entry.expenses += amount;
  }
  return months.map((month) => {
    const entry = byMonth.get(month);
    if (!entry) throw new RangeError('Unreachable: month was registered above');
    return entry;
  });
}
