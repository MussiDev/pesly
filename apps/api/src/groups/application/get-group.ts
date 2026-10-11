import { ResourceNotFound } from '../../shared/access';
import type { GroupDetail, GroupSummary } from '../domain/group';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface GetGroupDependencies {
  groups: GroupRepository;
}

export type GroupWithMembers = GroupSummary & Pick<GroupDetail, 'members' | 'formerMembers'>;

export class GetGroup {
  private readonly access: GroupAccess;

  constructor(private readonly deps: GetGroupDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  async execute(userId: string, groupId: string): Promise<GroupWithMembers> {
    const caller = await this.access.member(userId, groupId);
    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    return {
      group: detail.group,
      role: caller.role,
      memberCount: detail.members.length,
      members: detail.members,
      formerMembers: detail.formerMembers,
    };
  }
}
