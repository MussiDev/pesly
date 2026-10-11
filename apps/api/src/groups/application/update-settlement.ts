import type { UpdateSettlementRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import { GroupSettlementConsolidated } from '../domain/errors';
import {
  assertCanChangeRecord,
  assertChangedMembersActive,
  isConsolidated,
  settlementChangedMembers,
  settlementSnapshot,
} from '../domain/group-change';
import { isTooFarAhead } from '../domain/group-expense';
import {
  SettlementAmountNotPositive,
  SettlementDateTooFarAhead,
  type GroupSettlement,
} from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type { GroupSettlementRepository } from './ports/group-settlement-repository';

export interface UpdateSettlementDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
  clock: Clock;
}

export class UpdateSettlement {
  private readonly access: GroupAccess;

  constructor(private readonly deps: UpdateSettlementDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * The author or an admin (spec D1). Changes the amount and/or the date of a plain settlement;
   * its single leg follows (D2). Order: group access, record, permission, consolidated (409),
   * former member (409), then the new values.
   */
  async execute(
    userId: string,
    groupId: string,
    settlementId: string,
    data: UpdateSettlementRequest,
  ): Promise<GroupSettlement> {
    const caller = await this.access.member(userId, groupId);
    const settlement = await this.deps.settlements.getSettlement(groupId, settlementId);
    if (settlement === null) throw new ResourceNotFound();
    assertCanChangeRecord(caller, settlement.createdByMemberId);
    if (isConsolidated(settlement)) throw new GroupSettlementConsolidated();

    const amount = data.amount !== undefined ? BigInt(data.amount) : settlement.amount;
    const occurredAt =
      data.occurredAt !== undefined ? new Date(data.occurredAt) : settlement.occurredAt;
    const legs = [{ currency: settlement.currency, amount }];

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    assertChangedMembersActive(
      settlementChangedMembers(settlement, {
        fromMemberId: settlement.fromMemberId,
        toMemberId: settlement.toMemberId,
        legs,
      }),
      new Set(detail.members.map((member) => member.id)),
    );

    if (amount <= 0n) throw new SettlementAmountNotPositive();
    const now = this.deps.clock.now();
    if (data.occurredAt !== undefined && isTooFarAhead(occurredAt, now)) {
      throw new SettlementDateTooFarAhead();
    }

    // Only what the request names goes down: the repository fills the rest under lock.
    return this.deps.settlements.updateSettlement({
      groupId,
      settlementId,
      ...(data.amount !== undefined ? { amount } : {}),
      ...(data.occurredAt !== undefined ? { occurredAt } : {}),
      activity: {
        action: 'settlement_updated',
        memberId: caller.id,
        createdAt: now,
        before: settlementSnapshot(settlement),
        after: settlementSnapshot({ ...settlement, amount, occurredAt, legs }),
      },
    });
  }
}
