import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  AcceptInvitationData,
  AddGhostData,
  ClaimGhostData,
  CreateGroupData,
  GroupRepository,
  NewGroupCategory,
  ReplaceClaimLinkData,
  UpdateGroupCategoryFields,
  UpsertInvitationData,
} from '../../application/ports/group-repository';
import type { Group, GroupDetail, GroupSummary } from '../../domain/group';
import type { GroupCategory } from '../../domain/group-category';
import {
  GroupAlreadyMember,
  GroupCategoryNameTaken,
  GroupMemberLimitReached,
  TokenInvalid,
} from '../../domain/errors';
import type { Member } from '../../domain/member';
import { users } from './foreign-relations';
import { groupCategories, groupClaimLinks, groupInvitations, groupMembers, groups } from './schema';

/** The transaction handle drizzle passes to the callback of `Database.transaction`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const MEMBER_PER_USER_INDEX = 'group_members_group_user_unique';
const CATEGORY_NAME_INDEX = 'group_categories_group_name_unique';

const groupColumns = {
  id: groups.id,
  name: groups.name,
  defaultRateType: groups.defaultRateType,
  createdAt: groups.createdAt,
};

// A registered member has no stored name: it comes from the user, who may have none.
const memberColumns = {
  id: groupMembers.id,
  groupId: groupMembers.groupId,
  userId: groupMembers.userId,
  displayName: sql<string | null>`coalesce(${groupMembers.displayName}, ${users.displayName})`.as(
    'member_display_name',
  ),
  role: groupMembers.role,
  joinedAt: groupMembers.joinedAt,
};

const categoryColumns = {
  id: groupCategories.id,
  groupId: groupCategories.groupId,
  defaultKey: groupCategories.defaultKey,
  name: groupCategories.name,
  icon: groupCategories.icon,
  color: groupCategories.color,
  archivedAt: groupCategories.archivedAt,
  createdAt: groupCategories.createdAt,
};

function selectMembers(db: Database | Tx) {
  return db
    .select(memberColumns)
    .from(groupMembers)
    .leftJoin(users, eq(users.id, groupMembers.userId));
}

async function memberCount(db: Database | Tx, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return row?.n ?? 0;
}

/** Serializes every add-member path of one group; held until the transaction ends (spec D6). */
async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
}

async function assertRoom(tx: Tx, groupId: string, limit: number): Promise<void> {
  if ((await memberCount(tx, groupId)) >= limit) throw new GroupMemberLimitReached();
}

async function isMember(tx: Tx, groupId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

async function requireMember(tx: Tx, groupId: string, memberId: string): Promise<Member> {
  const [row] = await selectMembers(tx)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
    .limit(1);
  if (!row) throw new Error('Reading back a group member returned no row');
  return row;
}

/** Maps the unique index that backs "one membership per user" to its typed error. */
function mapAlreadyMember(error: unknown): never {
  if (violatedConstraint(error, '23505') === MEMBER_PER_USER_INDEX) throw new GroupAlreadyMember();
  throw error;
}

function mapCategoryName(error: unknown): never {
  if (violatedConstraint(error, '23505') === CATEGORY_NAME_INDEX)
    throw new GroupCategoryNameTaken();
  throw error;
}

export class DrizzleGroupRepository implements GroupRepository {
  constructor(private readonly db: Database) {}

  async create(data: CreateGroupData): Promise<GroupSummary> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(groups)
        .values({ name: data.name, defaultRateType: data.defaultRateType })
        .returning(groupColumns);
      if (!group) throw new Error('Inserting a group returned no row');
      await tx
        .insert(groupMembers)
        .values({ groupId: group.id, userId: data.creatorUserId, role: 'admin' });
      if (data.categories.length > 0) {
        await tx
          .insert(groupCategories)
          .values(data.categories.map((category) => ({ groupId: group.id, ...category })));
      }
      return { group, role: 'admin' as const, memberCount: 1 };
    });
  }

  async findMember(groupId: string, userId: string): Promise<Member | null> {
    const [row] = await selectMembers(this.db)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMemberById(groupId: string, memberId: string): Promise<Member | null> {
    const [row] = await selectMembers(this.db)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .limit(1);
    return row ?? null;
  }

  async getGroup(groupId: string): Promise<GroupDetail | null> {
    const [group] = await this.db
      .select(groupColumns)
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group) return null;
    const members = await selectMembers(this.db)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id));
    return { group, members };
  }

  async getSummary(groupId: string, userId: string): Promise<GroupSummary | null> {
    const [row] = await this.db
      .select({ group: groupColumns, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    if (!row) return null;
    return { group: row.group, role: row.role, memberCount: await memberCount(this.db, groupId) };
  }

  async listForUser(userId: string): Promise<GroupSummary[]> {
    const own = await this.db
      .select({ group: groupColumns, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, userId))
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id));
    if (own.length === 0) return [];
    const counts = await this.db
      .select({ groupId: groupMembers.groupId, n: count() })
      .from(groupMembers)
      .where(
        inArray(
          groupMembers.groupId,
          own.map((row) => row.group.id),
        ),
      )
      .groupBy(groupMembers.groupId);
    const byGroup = new Map(counts.map((row) => [row.groupId, row.n]));
    return own.map((row) => ({ ...row, memberCount: byGroup.get(row.group.id) ?? 0 }));
  }

  async addGhost(data: AddGhostData): Promise<Member> {
    return this.db.transaction(async (tx) => {
      await lockGroup(tx, data.groupId);
      await assertRoom(tx, data.groupId, data.limit);
      const [row] = await tx
        .insert(groupMembers)
        .values({ groupId: data.groupId, displayName: data.displayName })
        .returning({ id: groupMembers.id });
      if (!row) throw new Error('Inserting a ghost member returned no row');
      return requireMember(tx, data.groupId, row.id);
    });
  }

  async upsertInvitation(data: UpsertInvitationData): Promise<void> {
    await this.db
      .insert(groupInvitations)
      .values({
        groupId: data.groupId,
        createdByMemberId: data.memberId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      })
      .onConflictDoUpdate({
        target: groupInvitations.createdByMemberId,
        set: { tokenHash: data.tokenHash, expiresAt: data.expiresAt, createdAt: sql`now()` },
      });
  }

  async acceptInvitation(data: AcceptInvitationData): Promise<Member> {
    try {
      return await this.db.transaction(async (tx) => {
        const [invitation] = await tx
          .select({ groupId: groupInvitations.groupId })
          .from(groupInvitations)
          .where(
            and(
              eq(groupInvitations.tokenHash, data.tokenHash),
              sql`${groupInvitations.expiresAt} > ${data.now}`,
            ),
          )
          .limit(1);
        if (!invitation) throw new TokenInvalid();
        // Lock first so the membership check and the count see every earlier add.
        await lockGroup(tx, invitation.groupId);
        if (await isMember(tx, invitation.groupId, data.userId)) throw new GroupAlreadyMember();
        await assertRoom(tx, invitation.groupId, data.limit);
        const [row] = await tx
          .insert(groupMembers)
          .values({ groupId: invitation.groupId, userId: data.userId })
          .returning({ id: groupMembers.id });
        if (!row) throw new Error('Inserting a member returned no row');
        return requireMember(tx, invitation.groupId, row.id);
      });
    } catch (error) {
      return mapAlreadyMember(error);
    }
  }

  async replaceClaimLink(data: ReplaceClaimLinkData): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serializes concurrent replacements of one ghost's link; the unique index is the backstop.
      await tx
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(and(eq(groupMembers.id, data.memberId), eq(groupMembers.groupId, data.groupId)))
        .for('update');
      await tx
        .delete(groupClaimLinks)
        .where(and(eq(groupClaimLinks.memberId, data.memberId), isNull(groupClaimLinks.usedAt)));
      await tx.insert(groupClaimLinks).values({
        groupId: data.groupId,
        memberId: data.memberId,
        tokenHash: data.tokenHash,
      });
    });
  }

  async claimGhost(data: ClaimGhostData): Promise<Member> {
    try {
      return await this.db.transaction(async (tx) => {
        // A concurrent claim of the same link waits on this row, then finds `used_at` set.
        const [link] = await tx
          .update(groupClaimLinks)
          .set({ usedAt: data.now })
          .where(and(eq(groupClaimLinks.tokenHash, data.tokenHash), isNull(groupClaimLinks.usedAt)))
          .returning({ memberId: groupClaimLinks.memberId, groupId: groupClaimLinks.groupId });
        if (!link) throw new TokenInvalid();
        // Throwing here rolls the single-use mark back, so the link stays usable (spec D7).
        if (await isMember(tx, link.groupId, data.userId)) throw new GroupAlreadyMember();
        const claimed = await tx
          .update(groupMembers)
          .set({ userId: data.userId, displayName: null })
          .where(
            and(
              eq(groupMembers.id, link.memberId),
              eq(groupMembers.groupId, link.groupId),
              isNull(groupMembers.userId),
            ),
          )
          .returning({ id: groupMembers.id });
        if (claimed.length === 0) throw new TokenInvalid();
        return requireMember(tx, link.groupId, link.memberId);
      });
    } catch (error) {
      return mapAlreadyMember(error);
    }
  }

  async setAdmin(groupId: string, memberId: string): Promise<Member | null> {
    const updated = await this.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .returning({ id: groupMembers.id });
    if (updated.length === 0) return null;
    return this.findMemberById(groupId, memberId);
  }

  async setDefaultRateType(
    groupId: string,
    rateType: Group['defaultRateType'],
  ): Promise<Group | null> {
    const [row] = await this.db
      .update(groups)
      .set({ defaultRateType: rateType, updatedAt: new Date() })
      .where(eq(groups.id, groupId))
      .returning(groupColumns);
    return row ?? null;
  }

  listCategories(groupId: string): Promise<GroupCategory[]> {
    return this.db
      .select(categoryColumns)
      .from(groupCategories)
      .where(eq(groupCategories.groupId, groupId))
      .orderBy(asc(groupCategories.createdAt), asc(groupCategories.id));
  }

  async addCategory(groupId: string, data: NewGroupCategory): Promise<GroupCategory> {
    try {
      const [row] = await this.db
        .insert(groupCategories)
        .values({ groupId, ...data })
        .returning(categoryColumns);
      if (!row) throw new Error('Inserting a group category returned no row');
      return row;
    } catch (error) {
      return mapCategoryName(error);
    }
  }

  async updateCategory(
    groupId: string,
    categoryId: string,
    fields: UpdateGroupCategoryFields,
  ): Promise<GroupCategory | null> {
    try {
      const [row] = await this.db
        .update(groupCategories)
        .set({
          updatedAt: new Date(),
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
          ...(fields.color !== undefined ? { color: fields.color } : {}),
          ...(fields.archivedAt !== undefined ? { archivedAt: fields.archivedAt } : {}),
        })
        .where(and(eq(groupCategories.groupId, groupId), eq(groupCategories.id, categoryId)))
        .returning(categoryColumns);
      return row ?? null;
    } catch (error) {
      return mapCategoryName(error);
    }
  }

  /** Stub so the port compiles; DISC-001-05c Block 5 implements the transaction of spec D9, D10. */
  removeMember(): Promise<Member> {
    return Promise.reject(new Error('not implemented: Block 5'));
  }
}
