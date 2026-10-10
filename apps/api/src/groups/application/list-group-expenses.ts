import { GROUP_EXPENSES_PAGE_SIZE_DEFAULT, type ListGroupExpensesQuery } from '@pesly/shared';
import { GroupAccess } from './group-access';
import type {
  GroupExpensePageResult,
  GroupExpenseRepository,
} from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface ListGroupExpensesDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
}

export class ListGroupExpenses {
  private readonly access: GroupAccess;

  constructor(private readonly deps: ListGroupExpensesDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member; newest first, keyset-paginated. */
  async execute(
    userId: string,
    groupId: string,
    query: ListGroupExpensesQuery,
  ): Promise<GroupExpensePageResult> {
    await this.access.member(userId, groupId);
    return this.deps.expenses.listExpenses(groupId, {
      limit: query.limit ?? GROUP_EXPENSES_PAGE_SIZE_DEFAULT,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  }
}
