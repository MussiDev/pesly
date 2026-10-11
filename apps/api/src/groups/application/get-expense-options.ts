import type { RateType } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import type { DefaultSplit } from '../domain/group-expense';
import type { GroupCategory } from '../domain/group-category';
import type { Member } from '../domain/member';
import { GroupAccess } from './group-access';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface GetExpenseOptionsDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
}

export interface ExpenseOptions {
  /** Oldest first. */
  members: Member[];
  /** Non-archived only. */
  categories: GroupCategory[];
  defaultSplit: DefaultSplit;
  defaultRateType: RateType;
}

export class GetExpenseOptions {
  private readonly access: GroupAccess;

  constructor(private readonly deps: GetExpenseOptionsDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member: everything a new expense needs, in one call (spec D9). */
  async execute(userId: string, groupId: string): Promise<ExpenseOptions> {
    await this.access.member(userId, groupId);
    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const [categories, defaultSplit] = await Promise.all([
      this.deps.groups.listCategories(groupId),
      this.deps.expenses.getDefaultSplit(groupId),
    ]);
    return {
      members: detail.members,
      categories: categories.filter((category) => category.archivedAt === null),
      defaultSplit,
      defaultRateType: detail.group.defaultRateType,
    };
  }
}
