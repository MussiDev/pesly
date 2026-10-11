import { GROUP_ACTIVITY_PAGE_SIZE_DEFAULT, type ListActivityQuery } from '@pesly/shared';
import { GroupAccess } from './group-access';
import type { ActivityLogReader, ActivityPageResult } from './ports/activity-log-reader';
import type { GroupRepository } from './ports/group-repository';

export interface ListActivityDependencies {
  groups: GroupRepository;
  activity: ActivityLogReader;
}

export class ListActivity {
  private readonly access: GroupAccess;

  constructor(private readonly deps: ListActivityDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any active member (spec D9); newest first, keyset-paginated. */
  async execute(
    userId: string,
    groupId: string,
    query: ListActivityQuery,
  ): Promise<ActivityPageResult> {
    await this.access.member(userId, groupId);
    return this.deps.activity.list(groupId, {
      limit: query.limit ?? GROUP_ACTIVITY_PAGE_SIZE_DEFAULT,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  }
}
