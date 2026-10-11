import { GROUP_SETTLEMENTS_PAGE_SIZE_DEFAULT, type ListSettlementsQuery } from '@pesly/shared';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';
import type {
  GroupSettlementPageResult,
  GroupSettlementRepository,
} from './ports/group-settlement-repository';

export interface ListSettlementsDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
}

export class ListSettlements {
  private readonly access: GroupAccess;

  constructor(private readonly deps: ListSettlementsDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member; newest first, keyset-paginated. */
  async execute(
    userId: string,
    groupId: string,
    query: ListSettlementsQuery,
  ): Promise<GroupSettlementPageResult> {
    await this.access.member(userId, groupId);
    return this.deps.settlements.listSettlements(groupId, {
      limit: query.limit ?? GROUP_SETTLEMENTS_PAGE_SIZE_DEFAULT,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  }
}
