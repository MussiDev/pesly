import type { AddGhostMemberRequest } from '@pesly/shared';
import { MAX_GROUP_MEMBERS } from '../domain/group';
import type { Member } from '../domain/member';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface AddGhostMemberDependencies {
  groups: GroupRepository;
}

export class AddGhostMember {
  private readonly access: GroupAccess;

  constructor(private readonly deps: AddGhostMemberDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. The repository enforces the 50-member limit under a lock on the group. */
  async execute(userId: string, groupId: string, data: AddGhostMemberRequest): Promise<Member> {
    await this.access.member(userId, groupId);
    return this.deps.groups.addGhost({
      groupId,
      displayName: data.displayName,
      limit: MAX_GROUP_MEMBERS,
    });
  }
}
