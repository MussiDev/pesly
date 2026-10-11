import type { SettlementResponse } from '@pesly/shared';

export type GroupRole = 'admin' | 'member';

/**
 * Whether the caller may edit or delete a record: its creator or an admin of the group. This only
 * decides what the screens show; the API answers 403 and stays the authority.
 */
export function canEditRecord(
  createdByMemberId: string,
  selfMemberId: string,
  role: string | null | undefined,
): boolean {
  return createdByMemberId === selfMemberId || role === 'admin';
}

/** The caller's role in the group, or `null` when their member entry is not among the members. */
export function selfRole(
  members: readonly { id: string; role: string }[],
  selfMemberId: string,
): GroupRole | null {
  const role = members.find((member) => member.id === selfMemberId)?.role;
  return role === 'admin' || role === 'member' ? role : null;
}

/** A settlement that carries a rate came from a consolidation and can only be deleted. */
export function isConsolidatedSettlement(settlement: Pick<SettlementResponse, 'rate'>): boolean {
  return settlement.rate !== null;
}
