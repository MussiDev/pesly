import { DEFAULT_CATEGORIES, type CreateGroupRequest } from '@pesly/shared';
import type { GroupSummary } from '../domain/group';
import type { GroupRepository, NewGroupCategory } from './ports/group-repository';

export interface CreateGroupDependencies {
  groups: GroupRepository;
}

/** The top-level expense entries of PRD 02 Appendix A (spec D8). */
function defaultGroupCategories(): NewGroupCategory[] {
  return DEFAULT_CATEGORIES.filter(
    (entry) => entry.parentKey === null && entry.kind === 'expense',
  ).map((entry) => ({ defaultKey: entry.key, name: null, icon: entry.icon, color: entry.color }));
}

export class CreateGroup {
  constructor(private readonly deps: CreateGroupDependencies) {}

  /** `data` is already parsed. The creator becomes the group's first member, an admin. */
  async execute(userId: string, data: CreateGroupRequest): Promise<GroupSummary> {
    return this.deps.groups.create({
      name: data.name,
      defaultRateType: data.defaultRateType,
      creatorUserId: userId,
      categories: defaultGroupCategories(),
    });
  }
}
