import type { ConsolidationQuery, RateType } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import { GroupSettlementMemberInvalid } from '../domain/errors';
import { balancesByCurrency, pairLegs, type PairLegs } from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';
import type { GroupSettlementRepository } from './ports/group-settlement-repository';
import type { RateReader } from './ports/rate-reader';

export interface PreviewConsolidationDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
  rates: RateReader;
}

export interface ConsolidationPreviewResult {
  /** Signed from `memberA` to `memberB`. */
  legs: PairLegs;
  defaultRateType: RateType;
  /** The stored rate of the default type; null when none is stored. */
  rate: bigint | null;
}

export class PreviewConsolidation {
  private readonly access: GroupAccess;

  constructor(private readonly deps: PreviewConsolidationDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. Shows what a consolidation would clear and the rate to prefill (spec D8). */
  async execute(
    userId: string,
    groupId: string,
    query: ConsolidationQuery,
  ): Promise<ConsolidationPreviewResult> {
    await this.access.member(userId, groupId);
    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const active = new Set(detail.members.map((member) => member.id));
    if (!active.has(query.memberA) || !active.has(query.memberB)) {
      throw new GroupSettlementMemberInvalid();
    }
    const sources = await this.deps.settlements.readBalanceSources(groupId);
    const legs = pairLegs(balancesByCurrency(sources), query.memberA, query.memberB);
    const stored = await this.deps.rates.latestSell(detail.group.defaultRateType);
    return {
      legs,
      defaultRateType: detail.group.defaultRateType,
      rate: stored === null ? null : stored.sell,
    };
  }
}
