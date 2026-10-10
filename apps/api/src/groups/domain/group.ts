import type { GroupRole, RateType } from '@pesly/shared';
import type { Member } from './member';

/** Ghost members count (NFR-01, spec D6). */
export const MAX_GROUP_MEMBERS = 50;

/** An invitation is valid for exactly 7 days from creation (FR-03, spec D4). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Group {
  id: string;
  name: string;
  defaultRateType: RateType;
  createdAt: Date;
}

/** A group as one of its members sees it. */
export interface GroupSummary {
  group: Group;
  /** The caller's own role. */
  role: GroupRole;
  memberCount: number;
}

/** A group with its members, oldest first. */
export interface GroupDetail {
  group: Group;
  members: Member[];
}
