import { todayInTimeZone, type BudgetCurrency } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { BudgetMonthInFuture } from '../domain/errors';
import { monthBounds, monthOf, previousMonth } from '../domain/month';
import {
  computeBudgetSpending,
  effectiveNames,
  spendingOf,
  type BudgetSpendingResult,
} from '../domain/spending';
import type { CoveredCategory } from './ports/budget-version-reader';
import type { SpendingWindow } from './ports/spending-reader';
import type { SpendingDependencies } from './dependencies';

/** What the use cases return: the calculation plus the budget's identity, in `bigint`. */
export interface BudgetSpending extends BudgetSpendingResult {
  budgetId: string;
  name: string;
  currency: BudgetCurrency;
  month: string;
  amount: bigint;
  rolloverEnabled: boolean;
  spent: bigint;
  thresholds: number[];
  unconvertedShareCount: number;
}

/** The covered categories of a version as the pair the domain matches on. */
function coverage(categories: readonly CoveredCategory[]) {
  return {
    ids: new Set(categories.map((category) => category.id)),
    names: categories.flatMap((category) => effectiveNames(category)),
  };
}

/**
 * The shared orchestration of the two reads (D12): the month, the versions in force for it and
 * its previous month, one personal and one share read for every budget, then the pure calculation.
 * The previous month is read only when some budget has rollover on and a version existed then.
 */
export async function computeSpending(
  deps: SpendingDependencies,
  scope: AccessScope,
  requestedMonth: string | undefined,
  budgetId?: string,
): Promise<{ month: string; budgets: BudgetSpending[] }> {
  const timeZone = await deps.timeZones.timeZoneOf(scope.userId);
  const currentMonth = monthOf(todayInTimeZone(deps.clock.now(), timeZone));
  const month = requestedMonth ?? currentMonth;
  // `YYYY-MM` strings of the same width compare in calendar order.
  if (month > currentMonth) throw new BudgetMonthInFuture();
  const before = previousMonth(month);

  const found = await deps.versions.forMonths(scope, [month, before], budgetId);
  const entries = found.flatMap((entry) => {
    const current = entry.byMonth.get(month) ?? null;
    // A budget with no version in force that month did not exist yet (D3).
    if (current === null) return [];
    const previous = entry.byMonth.get(before) ?? null;
    return [{ entry, current, previous, carries: current.version.rollover && previous !== null }];
  });
  if (entries.length === 0) return { month, budgets: [] };

  const window: SpendingWindow = {
    current: monthBounds(month, timeZone),
    previous: entries.some((item) => item.carries) ? monthBounds(before, timeZone) : null,
  };

  const categoryIds = new Set<string>();
  for (const item of entries) {
    for (const category of item.current.covered) categoryIds.add(category.id);
    if (item.carries) {
      for (const category of item.previous?.covered ?? []) categoryIds.add(category.id);
    }
  }

  const personal = await deps.spending.personalSpending(scope, window, [...categoryIds]);
  const shares = await deps.spending.shareSpending(scope, window);

  const budgets = entries.map(({ entry, current, previous, carries }): BudgetSpending => {
    const now = coverage(current.covered);
    const spentNow = spendingOf(
      entry.currency,
      now.ids,
      now.names,
      personal.filter((row) => row.bucket === 'current'),
      shares.filter((row) => row.bucket === 'current'),
    );
    let spentPrevious = 0n;
    if (carries && previous) {
      const then = coverage(previous.covered);
      spentPrevious = spendingOf(
        entry.currency,
        then.ids,
        then.names,
        personal.filter((row) => row.bucket === 'previous'),
        shares.filter((row) => row.bucket === 'previous'),
      ).spent;
    }
    const result = computeBudgetSpending({
      currency: entry.currency,
      current: { amount: current.version.amount, rollover: current.version.rollover },
      previous: previous ? { amount: previous.version.amount } : null,
      spentCurrent: spentNow.spent,
      spentPrevious,
    });
    return {
      ...result,
      budgetId: entry.budgetId,
      name: current.version.name,
      currency: entry.currency,
      month,
      amount: current.version.amount,
      rolloverEnabled: current.version.rollover,
      spent: spentNow.spent,
      thresholds: [...current.version.thresholds],
      unconvertedShareCount: spentNow.unconvertedShareCount,
    };
  });
  return { month, budgets };
}
