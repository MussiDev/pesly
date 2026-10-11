import { ResourceNotFound } from '../../shared/access';
import type { GroupSettlement } from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { GroupSettlementRepository } from './ports/group-settlement-repository';
import type { GroupRepository } from './ports/group-repository';

export interface GetSettlementDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
}

export class GetSettlement {
  private readonly access: GroupAccess;

  constructor(private readonly deps: GetSettlementDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. A missing settlement and one of another group are the same `ResourceNotFound`. */
  async execute(userId: string, groupId: string, settlementId: string): Promise<GroupSettlement> {
    await this.access.member(userId, groupId);
    const settlement = await this.deps.settlements.getSettlement(groupId, settlementId);
    if (settlement === null) throw new ResourceNotFound();
    return settlement;
  }
}
