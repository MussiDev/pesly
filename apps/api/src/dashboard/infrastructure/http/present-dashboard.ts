import type { DashboardResponse } from '@pesly/shared';
import type { DashboardSections } from '../../application/get-dashboard';
import type { PerCurrency } from '../../domain/group-totals';

function amounts(value: PerCurrency): { ars: string; usd: string } {
  return { ars: value.ARS.toString(), usd: value.USD.toString() };
}

/** The only place where `bigint` becomes a string; the route validates the result. */
export function presentDashboard(sections: DashboardSections): DashboardResponse {
  const { context, netWorth, available, month, budgets, agenda, groups, firstSteps } = sections;
  return {
    currency: context.preferences.displayCurrency,
    today: context.today,
    netWorth: {
      ars: netWorth.ars.toString(),
      usd: netWorth.usd.toString(),
      total: netWorth.total === null ? null : netWorth.total.toString(),
      reason: netWorth.reason,
      holdingsWithoutPrice: netWorth.holdingsWithoutPrice,
      parts: {
        accounts: amounts(netWorth.parts.accounts),
        investments: amounts(netWorth.parts.investments),
        groups: amounts(netWorth.parts.groups),
        installmentDebt: amounts(netWorth.parts.installmentDebt),
      },
    },
    available: {
      ars: available.ars.toString(),
      usd: available.usd.toString(),
      total: available.total === null ? null : available.total.toString(),
      reason: available.reason,
    },
    month: {
      from: month.month.from,
      to: month.month.to,
      expenses: month.month.expenses.toString(),
      income: month.month.income.toString(),
      net: month.month.net.toString(),
      change: month.month.change,
      unconvertedShareCount: month.month.unconvertedShareCount,
      unconvertedInstallmentCount: month.month.unconvertedInstallmentCount,
    },
    categories: month.categories.map((row) => ({ ...row, amount: row.amount.toString() })),
    budgets: budgets.map((budget) => ({
      ...budget,
      available: budget.available.toString(),
      spent: budget.spent.toString(),
    })),
    upcoming: agenda.upcoming.map((item) => ({ ...item, amount: item.amount.toString() })),
    actions: agenda.actions,
    groups: { owedToYou: amounts(groups.owedToYou), youOwe: amounts(groups.youOwe) },
    insight: month.insight ? { ...month.insight, amount: month.insight.amount.toString() } : null,
    firstSteps,
  };
}
