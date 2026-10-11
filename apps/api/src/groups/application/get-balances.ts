import { ResourceNotFound } from '../../shared/access';
import { balancesByCurrency, presentBalances, type GroupBalances } from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';
import type { GroupSettlementRepository } from './ports/group-settlement-repository';

export interface GetBalancesDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
}

export class GetBalances {
  private readonly access: GroupAccess;

  constructor(private readonly deps: GetBalancesDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. Per currency: every active member, former members with a balance, the payments. */
  async execute(userId: string, groupId: string): Promise<GroupBalances> {
    await this.access.member(userId, groupId);
    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const sources = await this.deps.settlements.readBalanceSources(groupId);
    return presentBalances(
      balancesByCurrency(sources),
      detail.members.map((member) => member.id),
    );
  }
}
