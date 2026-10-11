import { ResourceNotFound } from '../../shared/access';
import { GroupMemberNotRegistered } from '../domain/errors';
import { canBeAdmin, type Member } from '../domain/member';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface MakeAdminDependencies {
  groups: GroupRepository;
}

export class MakeAdmin {
  private readonly access: GroupAccess;

  constructor(private readonly deps: MakeAdminDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Admin only. A ghost cannot be promoted (spec D2); promoting an admin again changes nothing. */
  async execute(userId: string, groupId: string, memberId: string): Promise<Member> {
    await this.access.admin(userId, groupId);
    const target = await this.deps.groups.findMemberById(groupId, memberId);
    if (target === null) throw new ResourceNotFound();
    if (!canBeAdmin(target)) throw new GroupMemberNotRegistered();
    const promoted = await this.deps.groups.setAdmin(groupId, memberId);
    if (promoted === null) throw new ResourceNotFound();
    return promoted;
  }
}
