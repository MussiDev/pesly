import type { GroupExpenseSummaryResponse } from '@pesly/shared';
import type { GroupExpenseSummary } from '../../application/summarize-group-expenses';
import { presentGroupCategory } from './group-presenter';

export function presentGroupExpenseSummary(
  summary: GroupExpenseSummary,
): GroupExpenseSummaryResponse {
  return {
    from: summary.from.toISOString(),
    to: summary.to.toISOString(),
    currencies: summary.currencies.map((entry) => ({
      currency: entry.currency,
      total: entry.total.toString(),
      count: entry.count,
      categories: entry.categories.map((line) => ({
        categoryId: line.categoryId,
        total: line.total.toString(),
        count: line.count,
      })),
    })),
    categories: summary.categories.map(presentGroupCategory),
  };
}
