import type { UpdateGroupCategoryRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import { GroupCategoryNameTaken } from '../domain/errors';
import { findNameConflict, type GroupCategory } from '../domain/group-category';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository, UpdateGroupCategoryFields } from './ports/group-repository';

export interface UpdateGroupCategoryDependencies {
  groups: GroupRepository;
  clock: Clock;
}

export class UpdateGroupCategory {
  private readonly access: GroupAccess;

  constructor(private readonly deps: UpdateGroupCategoryDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * Admin only. Renaming a default stores the custom name and keeps its key, as for personal
   * categories. Group categories are archived, never deleted.
   */
  async execute(
    userId: string,
    groupId: string,
    categoryId: string,
    data: UpdateGroupCategoryRequest,
  ): Promise<GroupCategory> {
    await this.access.admin(userId, groupId);
    const existing = await this.deps.groups.listCategories(groupId);
    if (!existing.some((category) => category.id === categoryId)) throw new ResourceNotFound();
    if (data.name !== undefined && findNameConflict(existing, data.name, categoryId) !== null) {
      throw new GroupCategoryNameTaken();
    }
    const fields: UpdateGroupCategoryFields = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.archived !== undefined
        ? { archivedAt: data.archived ? this.deps.clock.now() : null }
        : {}),
    };
    const updated = await this.deps.groups.updateCategory(groupId, categoryId, fields);
    if (updated === null) throw new ResourceNotFound();
    return updated;
  }
}
