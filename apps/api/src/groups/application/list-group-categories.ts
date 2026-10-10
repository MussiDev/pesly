import type { GroupCategory } from '../domain/group-category';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';

export interface ListGroupCategoriesDependencies {
  groups: GroupRepository;
}

export class ListGroupCategories {
  private readonly access: GroupAccess;

  constructor(private readonly deps: ListGroupCategoriesDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member; archived categories are included. */
  async execute(userId: string, groupId: string): Promise<GroupCategory[]> {
    await this.access.member(userId, groupId);
    return this.deps.groups.listCategories(groupId);
  }
}
