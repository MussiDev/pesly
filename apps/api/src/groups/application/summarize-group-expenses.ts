import type { AccountCurrency, GroupExpenseSummaryQuery } from '@pesly/shared';
import type { GroupCategory } from '../domain/group-category';
import { GroupAccess } from './group-access';
import type {
  ExpenseSummaryRow,
  GroupExpenseSummaryReader,
} from './ports/group-expense-summary-reader';
import type { GroupRepository } from './ports/group-repository';

export interface GroupExpenseSummaryLine {
  categoryId: string;
  total: bigint;
  count: number;
}

export interface GroupExpenseSummaryCurrency {
  currency: AccountCurrency;
  total: bigint;
  count: number;
  categories: GroupExpenseSummaryLine[];
}

export interface GroupExpenseSummary {
  from: Date;
  to: Date;
  currencies: GroupExpenseSummaryCurrency[];
  /** The categories the lines name, archived ones included. */
  categories: GroupCategory[];
}

export interface SummarizeGroupExpensesDependencies {
  groups: GroupRepository;
  summaries: GroupExpenseSummaryReader;
}

const CURRENCY_ORDER: readonly AccountCurrency[] = ['ARS', 'USD'];

function byTotalThenCategory(a: GroupExpenseSummaryLine, b: GroupExpenseSummaryLine): number {
  if (a.total !== b.total) return a.total > b.total ? -1 : 1;
  if (a.categoryId === b.categoryId) return 0;
  return a.categoryId < b.categoryId ? -1 : 1;
}

function currencyBlock(
  currency: AccountCurrency,
  rows: readonly ExpenseSummaryRow[],
): GroupExpenseSummaryCurrency {
  const categories = rows
    .map((row) => ({ categoryId: row.categoryId, total: row.total, count: row.count }))
    .sort(byTotalThenCategory);
  return {
    currency,
    total: categories.reduce((sum, line) => sum + line.total, 0n),
    count: categories.reduce((sum, line) => sum + line.count, 0),
    categories,
  };
}

export class SummarizeGroupExpenses {
  private readonly access: GroupAccess;

  constructor(private readonly deps: SummarizeGroupExpensesDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member; sums the whole range per currency and category, never across currencies. */
  async execute(
    userId: string,
    groupId: string,
    query: GroupExpenseSummaryQuery,
  ): Promise<GroupExpenseSummary> {
    await this.access.member(userId, groupId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const rows = await this.deps.summaries.summarize(groupId, { from, to });
    const currencies = CURRENCY_ORDER.flatMap((currency) => {
      const own = rows.filter((row) => row.currency === currency);
      return own.length === 0 ? [] : [currencyBlock(currency, own)];
    });
    const named = new Set(rows.map((row) => row.categoryId));
    const categories =
      named.size === 0
        ? []
        : (await this.deps.groups.listCategories(groupId)).filter((category) =>
            named.has(category.id),
          );
    return { from, to, currencies, categories };
  }
}
