import type { GroupSplitMode } from '@pesly/shared';

/**
 * Client state of the split editor. `selectedMemberIds` lists the members in the split, in joining
 * order; `values` holds the typed text per member (percentage or exact amount).
 */
export interface SplitState {
  mode: GroupSplitMode;
  selectedMemberIds: string[];
  values: Record<string, string>;
  amount: bigint;
  payerMemberId: string;
}

export function createSplitState(
  amount: bigint,
  payerMemberId: string,
  memberIds: readonly string[],
): SplitState {
  return { mode: 'equal', selectedMemberIds: [...memberIds], values: {}, amount, payerMemberId };
}

/** Changing the mode keeps amount, payer and selection, and resets only the per-member values. */
export function switchSplitMode(state: SplitState, mode: GroupSplitMode): SplitState {
  return { ...state, mode, values: {} };
}
