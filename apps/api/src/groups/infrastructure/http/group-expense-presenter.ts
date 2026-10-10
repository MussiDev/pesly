import type {
  DefaultSplitResponse,
  ExpenseOptionsResponse,
  GroupExpensePage,
  GroupExpenseResponse,
  PersonalSharesPage,
} from '@pesly/shared';
import type { ExpenseOptions } from '../../application/get-expense-options';
import type {
  GroupExpensePageResult,
  PersonalSharesPageResult,
} from '../../application/ports/group-expense-repository';
import type { DefaultSplit, GroupExpense } from '../../domain/group-expense';
import { isGhost } from '../../domain/member';
import { presentGroupCategory } from './group-presenter';

/** The only place where bigint amounts become strings and dates become ISO strings. */
export function presentGroupExpense(expense: GroupExpense): GroupExpenseResponse {
  return {
    id: expense.id,
    groupId: expense.groupId,
    payerMemberId: expense.payerMemberId,
    createdByMemberId: expense.createdByMemberId,
    amount: expense.amount.toString(),
    currency: expense.currency,
    occurredAt: expense.occurredAt.toISOString(),
    categoryId: expense.categoryId,
    description: expense.description,
    splitMode: expense.splitMode,
    payerMovementId: expense.payerMovementId,
    createdAt: expense.createdAt.toISOString(),
    shares: expense.shares.map((share) => ({
      memberId: share.memberId,
      amount: share.amount.toString(),
    })),
  };
}

export function presentGroupExpensePage(page: GroupExpensePageResult): GroupExpensePage {
  return { items: page.items.map(presentGroupExpense), nextCursor: page.nextCursor };
}

export function presentDefaultSplit(split: DefaultSplit): DefaultSplitResponse {
  if (split.mode === 'equal') return { mode: 'equal' };
  return {
    mode: 'percentage',
    shares: split.shares.map(({ memberId, basisPoints }) => ({ memberId, basisPoints })),
  };
}

/** A member shows no email and no user id, only what picking a payer or a split needs. */
export function presentExpenseOptions(options: ExpenseOptions): ExpenseOptionsResponse {
  return {
    members: options.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      isGhost: isGhost(member),
      joinedAt: member.joinedAt.toISOString(),
    })),
    categories: options.categories.map(presentGroupCategory),
    defaultSplit: presentDefaultSplit(options.defaultSplit),
    defaultRateType: options.defaultRateType,
  };
}

export function presentPersonalSharesPage(page: PersonalSharesPageResult): PersonalSharesPage {
  return {
    items: page.items.map((item) => ({
      expenseId: item.expenseId,
      groupId: item.groupId,
      currency: item.currency,
      occurredAt: item.occurredAt.toISOString(),
      shareAmount: item.shareAmount.toString(),
      receivableAmount: item.receivableAmount?.toString() ?? null,
    })),
    nextCursor: page.nextCursor,
  };
}
