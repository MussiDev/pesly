import { ResourceNotFound } from '../../shared/access';
import {
  assertCanChangeRecord,
  assertChangedMembersActive,
  expenseChangedMembers,
  expenseSnapshot,
} from '../domain/group-change';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface DeleteGroupExpenseDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  clock: Clock;
}

export class DeleteGroupExpense {
  private readonly access: GroupAccess;

  constructor(private readonly deps: DeleteGroupExpenseDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * The author or an admin (spec D1). Refuses with 409 when a member who left paid or holds a
   * share, since deleting would give them a balance (D5). The log row keeps the values it had.
   */
  async execute(userId: string, groupId: string, expenseId: string): Promise<void> {
    const caller = await this.access.member(userId, groupId);
    const expense = await this.deps.expenses.getExpense(groupId, expenseId);
    if (expense === null) throw new ResourceNotFound();
    assertCanChangeRecord(caller, expense.createdByMemberId);

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    assertChangedMembersActive(
      expenseChangedMembers(expense, null),
      new Set(detail.members.map((member) => member.id)),
    );

    await this.deps.expenses.deleteExpense({
      groupId,
      expenseId,
      rateType: detail.group.defaultRateType,
      activity: {
        action: 'expense_deleted',
        memberId: caller.id,
        createdAt: this.deps.clock.now(),
        before: expenseSnapshot(expense),
        after: null,
      },
    });
  }
}
