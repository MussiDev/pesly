import { ResourceNotFound } from '../../shared/access';
import { CannotRemoveSelf } from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';

export interface RemoveMemberDependencies {
  groups: GroupRepository;
  clock: Clock;
}

export class RemoveMember {
  private readonly access: GroupAccess;

  constructor(private readonly deps: RemoveMemberDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * Admin only, never the caller, who leaves instead (spec D9). The balance, last-admin and
   * deletion rules run inside `removeMember`, under the member lock (D10).
   */
  async execute(userId: string, groupId: string, memberId: string): Promise<void> {
    const caller = await this.access.admin(userId, groupId);
    if (caller.id === memberId) throw new CannotRemoveSelf();
    const target = await this.deps.groups.findMemberById(groupId, memberId);
    if (target === null) throw new ResourceNotFound();
    await this.deps.groups.removeMember({ groupId, memberId, leftAt: this.deps.clock.now() });
  }
}
