import type { DefaultSplitRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import {
  assertBasisPointsTotal,
  GroupSplitMemberInvalid,
  type DefaultSplit,
} from '../domain/group-expense';
import { GroupAccess } from './group-access';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';

export interface SetDefaultSplitDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
}

export class SetDefaultSplit {
  private readonly access: GroupAccess;

  constructor(private readonly deps: SetDefaultSplitDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Admin only; replaces the whole split. `equal` stores no members (spec D8). */
  async execute(userId: string, groupId: string, data: DefaultSplitRequest): Promise<DefaultSplit> {
    await this.access.admin(userId, groupId);
    if (data.mode === 'equal') {
      return this.deps.expenses.setDefaultSplit(groupId, { mode: 'equal' });
    }
    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const ids = new Set(detail.members.map((member) => member.id));
    if (data.shares.some((share) => !ids.has(share.memberId))) throw new GroupSplitMemberInvalid();
    assertBasisPointsTotal(data.shares);
    return this.deps.expenses.setDefaultSplit(groupId, {
      mode: 'percentage',
      shares: data.shares.map(({ memberId, basisPoints }) => ({ memberId, basisPoints })),
    });
  }
}
