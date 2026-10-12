import type { IncomeExpensesResponse } from '@pesly/shared';
import type { IncomeExpensesResult } from '../../application/get-income-expenses';

/** Amounts leave the module as exact integer strings, never as numbers. */
export function presentIncomeExpenses(result: IncomeExpensesResult): IncomeExpensesResponse {
  return {
    currency: result.currency,
    from: result.from,
    to: result.to,
    months: result.months.map((entry) => ({
      month: entry.month,
      income: entry.income.toString(),
      expenses: entry.expenses.toString(),
    })),
    unconvertedShareCount: result.unconvertedShareCount,
    unconvertedInstallmentCount: result.unconvertedInstallmentCount,
  };
}
