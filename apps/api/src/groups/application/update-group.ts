import type { UpdateGroupRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import type { GroupSummary } from '../domain/group';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface UpdateGroupDependencies {
  groups: GroupRepository;
}

export class UpdateGroup {
  private readonly access: GroupAccess;

  constructor(private readonly deps: UpdateGroupDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Admin only. Touches the default rate type alone; records already made keep their rate (AC-17). */
  async execute(userId: string, groupId: string, data: UpdateGroupRequest): Promise<GroupSummary> {
    await this.access.admin(userId, groupId);
    const group = await this.deps.groups.setDefaultRateType(groupId, data.defaultRateType);
    if (group === null) throw new ResourceNotFound();
    const summary = await this.deps.groups.getSummary(groupId, userId);
    if (summary === null) throw new ResourceNotFound();
    return summary;
  }
}
