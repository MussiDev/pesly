import type { GroupSplit, UpdateGroupExpenseRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import {
  assertCanChangeRecord,
  assertChangedMembersActive,
  expenseChangedMembers,
  expenseSnapshot,
} from '../domain/group-change';
import {
  ExpenseAmountNotPositive,
  ExpenseDateTooFarAhead,
  GroupExpenseCategoryInvalid,
  GroupSplitMemberInvalid,
  isTooFarAhead,
  type GroupExpense,
} from '../domain/group-expense';
import { allocateShares, splitMemberIds } from './allocate-expense-shares';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface UpdateGroupExpenseDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  clock: Clock;
}

/** True when the amount and every input of the split (members, mode, percentages or amounts) match. */
function splitUnchanged(expense: GroupExpense, amount: bigint, split: GroupSplit): boolean {
  if (amount !== expense.amount || split.mode !== expense.splitMode) return false;
  const stored = new Map(expense.shares.map((share) => [share.memberId, share]));
  const ids = splitMemberIds(split);
  if (new Set(ids).size !== ids.length || ids.length !== stored.size) return false;
  if (split.mode === 'equal') return ids.every((id) => stored.has(id));
  if (split.mode === 'percentage') {
    return split.shares.every(
      (input) => stored.get(input.memberId)?.basisPoints === input.basisPoints,
    );
  }
  return split.shares.every((input) => stored.get(input.memberId)?.amount === BigInt(input.amount));
}

export class UpdateGroupExpense {
  private readonly access: GroupAccess;

  constructor(private readonly deps: UpdateGroupExpenseDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * The author or an admin (spec D1). Replaces amount, date, category, description and split,
   * validated like creation; currency and payer stay as stored (D2). The order of checks is group
   * access, record, permission, then the new values. A change that would alter the balance of a
   * member who left answers 409 (D5); it is checked once the shares are allocated because that is
   * when the change per member is known.
   */
  async execute(
    userId: string,
    groupId: string,
    expenseId: string,
    data: UpdateGroupExpenseRequest,
  ): Promise<GroupExpense> {
    const caller = await this.access.member(userId, groupId);
    const expense = await this.deps.expenses.getExpense(groupId, expenseId);
    if (expense === null) throw new ResourceNotFound();
    assertCanChangeRecord(caller, expense.createdByMemberId);

    const amount = BigInt(data.amount);
    if (amount <= 0n) throw new ExpenseAmountNotPositive();
    const occurredAt = new Date(data.occurredAt);
    const now = this.deps.clock.now();
    if (isTooFarAhead(occurredAt, now)) throw new ExpenseDateTooFarAhead();

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const active = new Set(detail.members.map((member) => member.id));
    // A member who left may stay in the split only with an unchanged share; the check below
    // decides that, so they take part in the allocation like anyone else.
    const former = detail.formerMembers.map((member) => ({
      id: member.id,
      joinedAt: member.leftAt,
    }));
    const known = new Set([...active, ...former.map((member) => member.id)]);
    if (splitMemberIds(data.split).some((id) => !known.has(id))) {
      throw new GroupSplitMemberInvalid();
    }

    const categories = await this.deps.groups.listCategories(groupId);
    const category = categories.find((candidate) => candidate.id === data.categoryId);
    if (category === undefined || category.archivedAt !== null) {
      throw new GroupExpenseCategoryInvalid();
    }

    // Same amount and same split inputs: the stored shares stay as they are. Re-allocating could
    // move a leftover unit to another member (a former member is ordered by leaving date), which
    // would change a balance nobody asked to change.
    const shares = splitUnchanged(expense, amount, data.split)
      ? expense.shares.map((share) => ({ ...share }))
      : allocateShares(amount, expense.payerMemberId, data.split, [...detail.members, ...former]);
    assertChangedMembersActive(
      expenseChangedMembers(expense, { payerMemberId: expense.payerMemberId, amount, shares }),
      active,
    );

    const after = expenseSnapshot({
      amount,
      currency: expense.currency,
      occurredAt,
      categoryId: data.categoryId,
      description: data.description,
      splitMode: data.split.mode,
      payerMemberId: expense.payerMemberId,
      shares,
    });
    return this.deps.expenses.updateExpense({
      groupId,
      expenseId,
      amount,
      occurredAt,
      categoryId: data.categoryId,
      description: data.description,
      splitMode: data.split.mode,
      shares,
      rateType: detail.group.defaultRateType,
      activity: {
        action: 'expense_updated',
        memberId: caller.id,
        createdAt: now,
        before: expenseSnapshot(expense),
        after,
      },
    });
  }
}
