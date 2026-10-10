import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';

export interface LeaveGroupDependencies {
  groups: GroupRepository;
  clock: Clock;
}

export class LeaveGroup {
  private readonly access: GroupAccess;

  constructor(private readonly deps: LeaveGroupDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member, at balance 0 in every currency (spec D9); the checks run in `removeMember`. */
  async execute(userId: string, groupId: string): Promise<void> {
    const caller = await this.access.member(userId, groupId);
    await this.deps.groups.removeMember({
      groupId,
      memberId: caller.id,
      leftAt: this.deps.clock.now(),
    });
  }
}
