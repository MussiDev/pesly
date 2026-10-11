import type { GroupRole } from '@pesly/shared';

export interface Member {
  id: string;
  groupId: string;
  /** Null for a ghost member. */
  userId: string | null;
  /** Set only while the member is a ghost; a registered member shows the user's own name. */
  displayName: string | null;
  role: GroupRole;
  joinedAt: Date;
}

/** A member who left or was removed; named so the history that mentions them stays readable. */
export interface FormerMember {
  id: string;
  displayName: string | null;
  leftAt: Date;
}

export function isGhost(member: Member): boolean {
  return member.userId === null;
}

export function isAdmin(member: Member): boolean {
  return member.role === 'admin';
}

/** Only a registered member can be an admin (spec D2). */
export function canBeAdmin(member: Member): boolean {
  return !isGhost(member);
}
