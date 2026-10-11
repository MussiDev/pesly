import { ResourceNotFound } from '../../shared/access';
import type { GroupExpense } from '../domain/group-expense';
import { GroupAccess } from './group-access';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface GetGroupExpenseDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
}

export class GetGroupExpense {
  private readonly access: GroupAccess;

  constructor(private readonly deps: GetGroupExpenseDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. A missing expense and one of another group are the same `ResourceNotFound`. */
  async execute(userId: string, groupId: string, expenseId: string): Promise<GroupExpense> {
    await this.access.member(userId, groupId);
    const expense = await this.deps.expenses.getExpense(groupId, expenseId);
    if (expense === null) throw new ResourceNotFound();
    return expense;
  }
}
