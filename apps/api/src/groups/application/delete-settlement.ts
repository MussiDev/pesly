import { ResourceNotFound } from '../../shared/access';
import {
  assertCanChangeRecord,
  assertChangedMembersActive,
  settlementChangedMembers,
  settlementSnapshot,
} from '../domain/group-change';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type { GroupSettlementRepository } from './ports/group-settlement-repository';

export interface DeleteSettlementDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
  clock: Clock;
}

export class DeleteSettlement {
  private readonly access: GroupAccess;

  constructor(private readonly deps: DeleteSettlementDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * The author or an admin (spec D1); a consolidated settlement may be deleted (D2). Refuses with
   * 409 when a party left, since the deletion would give them a balance (D5).
   */
  async execute(userId: string, groupId: string, settlementId: string): Promise<void> {
    const caller = await this.access.member(userId, groupId);
    const settlement = await this.deps.settlements.getSettlement(groupId, settlementId);
    if (settlement === null) throw new ResourceNotFound();
    assertCanChangeRecord(caller, settlement.createdByMemberId);

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    assertChangedMembersActive(
      settlementChangedMembers(settlement, null),
      new Set(detail.members.map((member) => member.id)),
    );

    await this.deps.settlements.deleteSettlement({
      groupId,
      settlementId,
      activity: {
        action: 'settlement_deleted',
        memberId: caller.id,
        createdAt: this.deps.clock.now(),
        before: settlementSnapshot(settlement),
        after: null,
      },
    });
  }
}
