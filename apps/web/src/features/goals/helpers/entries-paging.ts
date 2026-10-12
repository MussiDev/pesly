import { GOAL_ENTRIES_PAGE_SIZE_DEFAULT, GOAL_ENTRIES_PAGE_SIZE_MAX } from '@pesly/shared';

export const ENTRIES_FIRST_LIMIT = GOAL_ENTRIES_PAGE_SIZE_DEFAULT;

/** The limit "load more" asks for: 50, then 100, and it stops at 100. */
export function nextEntriesLimit(asked: number): number {
  return asked < GOAL_ENTRIES_PAGE_SIZE_DEFAULT
    ? GOAL_ENTRIES_PAGE_SIZE_DEFAULT
    : GOAL_ENTRIES_PAGE_SIZE_MAX;
}

/** More entries may exist only when the page came back full and fewer than 100 are shown. */
export function canLoadMore(returned: number, asked: number): boolean {
  return returned >= asked && returned < GOAL_ENTRIES_PAGE_SIZE_MAX;
}
