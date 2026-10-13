import type { CategoryLanguage, ExpenseOptionsResponse, GroupExpenseResponse } from '@pesly/shared';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { resolveCategory } from '../category-views/resolve-category';
import type { ExpenseListItem } from '../expenses/list/group-expenses-list';

export interface RecentExpenseContext {
  language: CategoryLanguage;
  timeZone: string;
  /** Translated text for a category the options do not list. */
  uncategorizedLabel: string;
  /** Translated text for a payer the options do not list. */
  unnamedLabel: string;
}

/** The rows of the recent expenses, in the order given; read-only, so no row carries edit actions. */
export function buildRecentExpenseItems(
  expenses: readonly GroupExpenseResponse[],
  options: ExpenseOptionsResponse,
  context: RecentExpenseContext,
): ExpenseListItem[] {
  const { language, timeZone, uncategorizedLabel, unnamedLabel } = context;
  return expenses.map((expense) => {
    const own = expense.shares.find((share) => share.memberId === options.selfMemberId);
    return {
      id: expense.id,
      description: expense.description,
      category: resolveCategory(
        expense.categoryId,
        options.categories,
        language,
        uncategorizedLabel,
      ),
      payer:
        options.members.find((member) => member.id === expense.payerMemberId)?.displayName ??
        unnamedLabel,
      amount: formatMoney(BigInt(expense.amount), expense.currency, language),
      date: formatDateTime(expense.occurredAt, timeZone, language),
      share:
        own === undefined ? undefined : formatMoney(BigInt(own.amount), expense.currency, language),
    };
  });
}
