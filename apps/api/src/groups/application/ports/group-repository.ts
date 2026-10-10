import type { CategoryColor, CategoryIcon, RateType } from '@pesly/shared';
import type { Group, GroupDetail, GroupSummary } from '../../domain/group';
import type { GroupCategory } from '../../domain/group-category';
import type { Member } from '../../domain/member';

export interface NewGroupCategory {
  defaultKey: string | null;
  name: string | null;
  icon: CategoryIcon;
  color: CategoryColor;
}

export interface CreateGroupData {
  name: string;
  defaultRateType: RateType;
  creatorUserId: string;
  /** Inserted with the group and its admin member, in one transaction. */
  categories: NewGroupCategory[];
}

export interface AddGhostData {
  groupId: string;
  displayName: string;
  /** Maximum members, ghosts included; checked under a lock on the group. */
  limit: number;
}

export interface UpsertInvitationData {
  groupId: string;
  /** The creating member: at most one invitation per member (spec D16). */
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AcceptInvitationData {
  tokenHash: string;
  userId: string;
  now: Date;
  limit: number;
}

export interface ReplaceClaimLinkData {
  groupId: string;
  memberId: string;
  tokenHash: string;
}

export interface ClaimGhostData {
  tokenHash: string;
  userId: string;
  now: Date;
}

/** A defined field is written; `archivedAt: null` restores an archived category. */
export interface UpdateGroupCategoryFields {
  name?: string;
  icon?: CategoryIcon;
  color?: CategoryColor;
  archivedAt?: Date | null;
}

/**
 * Atomic operations named after intent; the Drizzle adapter makes each one a single transaction.
 * Rules that need state but no atomicity (roles, name clashes) run in the use cases.
 */
export interface GroupRepository {
  /** Group, admin member for `creatorUserId` and the categories, in one call. */
  create(data: CreateGroupData): Promise<GroupSummary>;
  findMember(groupId: string, userId: string): Promise<Member | null>;
  findMemberById(groupId: string, memberId: string): Promise<Member | null>;
  /** Members oldest first (`joined_at`, `id`). */
  getGroup(groupId: string): Promise<GroupDetail | null>;
  /** The group as seen by `userId`; null when it does not exist or the user is not in it. */
  getSummary(groupId: string, userId: string): Promise<GroupSummary | null>;
  listForUser(userId: string): Promise<GroupSummary[]>;
  /** Locks the group, counts members and inserts; throws `GroupMemberLimitReached` at `limit`. */
  addGhost(data: AddGhostData): Promise<Member>;
  /** Insert, or replace the creating member's previous invitation. */
  upsertInvitation(data: UpsertInvitationData): Promise<void>;
  /**
   * One transaction: the invitation by `tokenHash` with `expiresAt > now` (else `TokenInvalid`),
   * `GroupAlreadyMember` if the user is in, lock and count (`GroupMemberLimitReached`), insert.
   */
  acceptInvitation(data: AcceptInvitationData): Promise<Member>;
  /** Drops the member's unused link and stores the new one. */
  replaceClaimLink(data: ReplaceClaimLinkData): Promise<void>;
  /**
   * One transaction: single-use mark of the link by `tokenHash` (else `TokenInvalid`), then the
   * member gets `userId` and loses `displayName`. `GroupAlreadyMember` rolls the mark back.
   */
  claimGhost(data: ClaimGhostData): Promise<Member>;
  /** Null when the member is not in the group. */
  setAdmin(groupId: string, memberId: string): Promise<Member | null>;
  setDefaultRateType(groupId: string, rateType: RateType): Promise<Group | null>;
  /** Archived ones included, oldest first. */
  listCategories(groupId: string): Promise<GroupCategory[]>;
  /** Throws `GroupCategoryNameTaken` if the unique index fires. */
  addCategory(groupId: string, data: NewGroupCategory): Promise<GroupCategory>;
  /** Null when the category is not in the group. */
  updateCategory(
    groupId: string,
    categoryId: string,
    fields: UpdateGroupCategoryFields,
  ): Promise<GroupCategory | null>;
}
