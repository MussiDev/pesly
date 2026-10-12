import { initialSplitState } from '@/features/groups/expenses/form/expense-request';
import type { SplitState } from '@/features/groups/split/split-state';

/** The category choice that omits `categoryId`; the server picks the equivalent group category, else "Other expenses" (spec D18). */
export const AUTOMATIC_CATEGORY = 'automatic';

/** The group to preselect: the only one the person has, otherwise none. */
export function pickOnlyGroup(groups: readonly { id: string }[]): string | undefined {
  const [only] = groups;
  return groups.length === 1 ? only?.id : undefined;
}

/**
 * Equal among every active member, whatever the group's own default split is (spec D15); the
 * editor still offers percentage and exact.
 */
export function defaultSendSplit(options: {
  selfMemberId: string;
  members: readonly { id: string }[];
}): SplitState {
  return initialSplitState(
    { mode: 'equal' },
    options.members.map((member) => member.id),
    options.selfMemberId,
  );
}
