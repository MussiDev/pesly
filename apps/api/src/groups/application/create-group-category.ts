import type { CreateGroupCategoryRequest } from '@pesly/shared';
import { GroupCategoryNameTaken } from '../domain/errors';
import { findNameConflict, type GroupCategory } from '../domain/group-category';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface CreateGroupCategoryDependencies {
  groups: GroupRepository;
}

export class CreateGroupCategory {
  private readonly access: GroupAccess;

  constructor(private readonly deps: CreateGroupCategoryDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Admin only. The unique index of the table is the backstop for a concurrent clash. */
  async execute(
    userId: string,
    groupId: string,
    data: CreateGroupCategoryRequest,
  ): Promise<GroupCategory> {
    await this.access.admin(userId, groupId);
    const existing = await this.deps.groups.listCategories(groupId);
    if (findNameConflict(existing, data.name, null) !== null) throw new GroupCategoryNameTaken();
    return this.deps.groups.addCategory(groupId, {
      defaultKey: null,
      name: data.name,
      icon: data.icon,
      color: data.color,
    });
  }
}
