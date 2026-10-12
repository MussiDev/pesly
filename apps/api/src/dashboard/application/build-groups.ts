import type { AccessScope } from '../../shared/access';
import { groupTotalsOf, netOf, type GroupTotals, type PerCurrency } from '../domain/group-totals';
import type { GroupBalanceReader, GroupBalanceSource } from './ports/group-balance-reader';

export interface GroupsSection extends GroupTotals {
  /** Owed minus owing, per currency; the group part of the net worth. */
  net: PerCurrency;
}

export interface GroupsDependencies {
  groupBalances: GroupBalanceReader;
}

export function buildGroups(entries: readonly GroupBalanceSource[]): GroupsSection {
  const totals = groupTotalsOf(entries);
  return { ...totals, net: netOf(totals) };
}

/** Reads once; an error rejects the whole section and no partial group is returned. */
export async function loadGroups(
  deps: GroupsDependencies,
  scope: AccessScope,
): Promise<GroupsSection> {
  return buildGroups(await deps.groupBalances.sourcesOf(scope));
}
