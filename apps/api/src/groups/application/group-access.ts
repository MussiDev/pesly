import { ResourceNotFound } from '../../shared/access';
import { GroupAdminRequired } from '../domain/errors';
import { isAdmin, type Member } from '../domain/member';
import type { GroupRepository } from './ports/group-repository';

/**
 * Resolves the caller's membership before anything else (spec D1). A missing group and a group the
 * caller is not in answer the same `ResourceNotFound`.
 */
export class GroupAccess {
  constructor(private readonly groups: GroupRepository) {}

  async member(userId: string, groupId: string): Promise<Member> {
    const member = await this.groups.findMember(groupId, userId);
    if (member === null) throw new ResourceNotFound();
    return member;
  }

  async admin(userId: string, groupId: string): Promise<Member> {
    const member = await this.member(userId, groupId);
    if (!isAdmin(member)) throw new GroupAdminRequired();
    return member;
  }
}
