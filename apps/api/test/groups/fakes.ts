import { randomUUID } from 'node:crypto';
import type { GroupRole, RateType } from '@pesly/shared';
import {
  GroupAlreadyMember,
  GroupMemberLimitReached,
  TokenInvalid,
  type AcceptInvitationData,
  type AddGhostData,
  type Clock,
  type ClaimGhostData,
  type CreateGroupData,
  type Group,
  type GroupCategory,
  type GroupDetail,
  type GroupRepository,
  type GroupSummary,
  type IssuedToken,
  type Member,
  type NewGroupCategory,
  type RemoveMemberData,
  type ReplaceClaimLinkData,
  type TokenSource,
  type UpdateGroupCategoryFields,
  type UpsertInvitationData,
} from '../../src/groups';

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-10-10T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** Yields raw-1, raw-2, ...; the "hash" is a prefix, enough to tell tokens apart. */
export class DeterministicTokenSource implements TokenSource {
  private counter = 0;

  generate(): IssuedToken {
    this.counter += 1;
    const raw = `raw-${this.counter}`;
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return `hash:${raw}`;
  }
}

interface InvitationRow {
  groupId: string;
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
}

interface ClaimLinkRow {
  groupId: string;
  memberId: string;
  tokenHash: string;
  usedAt: Date | null;
}

/** Honors the same rules the Drizzle adapter enforces in SQL; atomicity itself is proven in Block 4. */
export class InMemoryGroupRepository implements GroupRepository {
  readonly groups = new Map<string, Group>();
  readonly members: Member[] = [];
  readonly categories = new Map<string, GroupCategory[]>();
  readonly invitations: InvitationRow[] = [];
  readonly claimLinks: ClaimLinkRow[] = [];

  constructor(private readonly clock: Clock) {}

  async create(data: CreateGroupData): Promise<GroupSummary> {
    await Promise.resolve();
    const group: Group = {
      id: randomUUID(),
      name: data.name,
      defaultRateType: data.defaultRateType,
      createdAt: this.clock.now(),
    };
    this.groups.set(group.id, group);
    this.members.push(this.newMember(group.id, data.creatorUserId, null, 'admin'));
    this.categories.set(
      group.id,
      data.categories.map((category) => this.newCategory(group.id, category)),
    );
    return { group, role: 'admin', memberCount: 1 };
  }

  async findMember(groupId: string, userId: string): Promise<Member | null> {
    await Promise.resolve();
    return this.members.find((m) => m.groupId === groupId && m.userId === userId) ?? null;
  }

  async findMemberById(groupId: string, memberId: string): Promise<Member | null> {
    await Promise.resolve();
    return this.members.find((m) => m.groupId === groupId && m.id === memberId) ?? null;
  }

  async getGroup(groupId: string): Promise<GroupDetail | null> {
    await Promise.resolve();
    const group = this.groups.get(groupId);
    if (group === undefined) return null;
    return { group, members: this.membersOf(groupId), formerMembers: [] };
  }

  async getSummary(groupId: string, userId: string): Promise<GroupSummary | null> {
    const group = this.groups.get(groupId);
    const member = await this.findMember(groupId, userId);
    if (group === undefined || member === null) return null;
    return { group, role: member.role, memberCount: this.membersOf(groupId).length };
  }

  async listForUser(userId: string): Promise<GroupSummary[]> {
    await Promise.resolve();
    const own = this.members.filter((m) => m.userId === userId);
    return own.flatMap((member) => {
      const group = this.groups.get(member.groupId);
      if (group === undefined) return [];
      return [{ group, role: member.role, memberCount: this.membersOf(group.id).length }];
    });
  }

  async addGhost(data: AddGhostData): Promise<Member> {
    await Promise.resolve();
    this.assertRoom(data.groupId, data.limit);
    const member = this.newMember(data.groupId, null, data.displayName, 'member');
    this.members.push(member);
    return member;
  }

  async upsertInvitation(data: UpsertInvitationData): Promise<void> {
    await Promise.resolve();
    const index = this.invitations.findIndex((row) => row.memberId === data.memberId);
    if (index >= 0) this.invitations.splice(index, 1);
    this.invitations.push({ ...data });
  }

  async acceptInvitation(data: AcceptInvitationData): Promise<Member> {
    const invitation = this.invitations.find((row) => row.tokenHash === data.tokenHash);
    if (invitation === undefined || invitation.expiresAt.getTime() <= data.now.getTime()) {
      throw new TokenInvalid();
    }
    if ((await this.findMember(invitation.groupId, data.userId)) !== null) {
      throw new GroupAlreadyMember();
    }
    this.assertRoom(invitation.groupId, data.limit);
    const member = this.newMember(invitation.groupId, data.userId, null, 'member');
    this.members.push(member);
    return member;
  }

  async replaceClaimLink(data: ReplaceClaimLinkData): Promise<void> {
    await Promise.resolve();
    const index = this.claimLinks.findIndex(
      (row) => row.memberId === data.memberId && row.usedAt === null,
    );
    if (index >= 0) this.claimLinks.splice(index, 1);
    this.claimLinks.push({ ...data, usedAt: null });
  }

  async claimGhost(data: ClaimGhostData): Promise<Member> {
    const link = this.claimLinks.find((row) => row.tokenHash === data.tokenHash);
    if (link === undefined || link.usedAt !== null) throw new TokenInvalid();
    if ((await this.findMember(link.groupId, data.userId)) !== null) {
      throw new GroupAlreadyMember();
    }
    const index = this.members.findIndex((m) => m.id === link.memberId);
    const current = this.members[index];
    if (current === undefined) throw new TokenInvalid();
    const claimed: Member = { ...current, userId: data.userId, displayName: null };
    this.members[index] = claimed;
    link.usedAt = data.now;
    return claimed;
  }

  async setAdmin(groupId: string, memberId: string): Promise<Member | null> {
    await Promise.resolve();
    const index = this.members.findIndex((m) => m.groupId === groupId && m.id === memberId);
    const current = this.members[index];
    if (current === undefined) return null;
    const updated: Member = { ...current, role: 'admin' };
    this.members[index] = updated;
    return updated;
  }

  async setDefaultRateType(groupId: string, rateType: RateType): Promise<Group | null> {
    await Promise.resolve();
    const group = this.groups.get(groupId);
    if (group === undefined) return null;
    const updated: Group = { ...group, defaultRateType: rateType };
    this.groups.set(groupId, updated);
    return updated;
  }

  async listCategories(groupId: string): Promise<GroupCategory[]> {
    await Promise.resolve();
    return [...(this.categories.get(groupId) ?? [])];
  }

  async addCategory(groupId: string, data: NewGroupCategory): Promise<GroupCategory> {
    await Promise.resolve();
    const category = this.newCategory(groupId, data);
    this.categories.set(groupId, [...(this.categories.get(groupId) ?? []), category]);
    return category;
  }

  async updateCategory(
    groupId: string,
    categoryId: string,
    fields: UpdateGroupCategoryFields,
  ): Promise<GroupCategory | null> {
    await Promise.resolve();
    const list = this.categories.get(groupId) ?? [];
    const index = list.findIndex((c) => c.id === categoryId);
    const current = list[index];
    if (current === undefined) return null;
    const updated: GroupCategory = {
      ...current,
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
      ...(fields.color !== undefined ? { color: fields.color } : {}),
      ...(fields.archivedAt !== undefined ? { archivedAt: fields.archivedAt } : {}),
    };
    list[index] = updated;
    return updated;
  }

  /** Needs the balances of the settlement fakes: see `InMemoryMembershipGroupRepository`. */
  removeMember(data: RemoveMemberData): Promise<Member> {
    return Promise.reject(
      new Error(`removeMember(${data.memberId}) needs InMemoryMembershipGroupRepository`),
    );
  }

  /** Test helper: puts a member in without the use-case rules. */
  seedMember(groupId: string, userId: string | null, displayName: string | null): Member {
    const member = this.newMember(groupId, userId, displayName, 'member');
    this.members.push(member);
    return member;
  }

  membersOf(groupId: string): Member[] {
    return this.members.filter((m) => m.groupId === groupId);
  }

  private assertRoom(groupId: string, limit: number): void {
    if (this.membersOf(groupId).length >= limit) throw new GroupMemberLimitReached();
  }

  private newMember(
    groupId: string,
    userId: string | null,
    displayName: string | null,
    role: GroupRole,
  ): Member {
    return { id: randomUUID(), groupId, userId, displayName, role, joinedAt: this.clock.now() };
  }

  private newCategory(groupId: string, data: NewGroupCategory): GroupCategory {
    return { id: randomUUID(), groupId, ...data, archivedAt: null, createdAt: this.clock.now() };
  }
}
