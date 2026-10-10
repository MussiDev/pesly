import { DEFAULT_CATEGORIES } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GroupAlreadyMember,
  GroupCategoryNameTaken,
  GroupMemberLimitReached,
  MAX_GROUP_MEMBERS,
  TokenInvalid,
  type NewGroupCategory,
} from '../../src/groups';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { RandomTokenSource } from '../../src/groups/infrastructure/crypto/random-token-source';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleGroupRepository;
const tokens = new RandomTokenSource();

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const NOW = new Date('2026-10-10T12:00:00.000Z');
const SECOND = 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

const defaultCategories = (): NewGroupCategory[] =>
  DEFAULT_CATEGORIES.filter((c) => c.parentKey === null && c.kind === 'expense').map((c) => ({
    defaultKey: c.key,
    name: null,
    icon: c.icon,
    color: c.color,
  }));

async function newGroup(creatorUserId: string, categories = defaultCategories()) {
  return repository.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId,
    categories,
  });
}

async function scalar(statement: string, params: unknown[]): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
}

const membersOf = (groupId: string) =>
  scalar('select count(*) as n from group_members where group_id = $1', [groupId]);

/** Fills the group with ghosts straight through SQL until it holds `total` members. */
async function fillTo(groupId: string, total: number): Promise<void> {
  const current = await membersOf(groupId);
  await connection.pool.query(
    `insert into group_members (group_id, display_name)
     select $1, 'Ghost ' || g from generate_series(1, $2::int) g`,
    [groupId, total - current],
  );
}

async function invitation(
  groupId: string,
  memberId: string,
  expiresAt = new Date(NOW.getTime() + WEEK),
) {
  const token = tokens.generate();
  await repository.upsertInvitation({ groupId, memberId, tokenHash: token.hash, expiresAt });
  return token;
}

async function adminMemberId(groupId: string, userId: string): Promise<string> {
  const member = await repository.findMember(groupId, userId);
  if (!member) throw new Error('The creator is not a member');
  return member.id;
}

describe('create', () => {
  it('stores the group, its admin member and the categories', async () => {
    const ana = await newUserId(connection.db);

    const summary = await newGroup(ana);

    expect(summary).toMatchObject({ role: 'admin', memberCount: 1 });
    expect(summary.group).toMatchObject({ name: 'Casa', defaultRateType: 'mep' });
    expect(await repository.findMember(summary.group.id, ana)).toMatchObject({
      role: 'admin',
      userId: ana,
    });
    const categories = await repository.listCategories(summary.group.id);
    expect(categories).toHaveLength(defaultCategories().length);
    expect(categories.every((c) => c.name === null && c.defaultKey !== null)).toBe(true);
  });

  it('rolls everything back when a category insert fails (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const [first] = defaultCategories();
    if (!first) throw new Error('No default categories');

    await expect(newGroup(ana, [first, first])).rejects.toThrow();

    expect(await scalar('select count(*) as n from groups', [])).toBe(0);
    expect(await scalar('select count(*) as n from group_members', [])).toBe(0);
  });
});

describe('reads', () => {
  it('reads a registered member name from the user, a ghost name from the member, oldest first', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    await connection.pool.query('update users set display_name = $2 where id = $1', [ana, 'Ana']);
    const { group } = await newGroup(ana);
    await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });
    const token = await invitation(group.id, await adminMemberId(group.id, ana));
    await repository.acceptInvitation({ tokenHash: token.hash, userId: bea, now: NOW, limit: 50 });

    const detail = await repository.getGroup(group.id);

    expect(detail?.members.map((m) => [m.displayName, m.userId === null])).toEqual([
      ['Ana', false],
      ['Pedro', true],
      [null, false],
    ]);
    expect(detail?.members.map((m) => m.role)).toEqual(['admin', 'member', 'member']);
  });

  it('returns null for an unknown group and for a summary of a non-member (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group } = await newGroup(ana);

    expect(await repository.getGroup('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await repository.getSummary(group.id, bea)).toBeNull();
    expect(await repository.findMember(group.id, bea)).toBeNull();
    expect(
      await repository.findMemberById(group.id, '00000000-0000-4000-8000-000000000000'),
    ).toBeNull();
    expect(await repository.getSummary(group.id, ana)).toMatchObject({
      role: 'admin',
      memberCount: 1,
    });
  });

  it('lists only the groups of the user with their member counts', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const first = await newGroup(ana);
    await newGroup(bea);
    await repository.addGhost({ groupId: first.group.id, displayName: 'Pedro', limit: 50 });

    const list = await repository.listForUser(ana);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ role: 'admin', memberCount: 2 });
    expect(list[0]?.group.id).toBe(first.group.id);
  });
});

describe('addGhost and the member limit', () => {
  it('adds a ghost without a user', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);

    const ghost = await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });

    expect(ghost).toMatchObject({ userId: null, displayName: 'Pedro', role: 'member' });
  });

  it('refuses the 51st member and stores nothing (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    await fillTo(group.id, MAX_GROUP_MEMBERS);

    await expect(
      repository.addGhost({ groupId: group.id, displayName: 'Extra', limit: MAX_GROUP_MEMBERS }),
    ).rejects.toBeInstanceOf(GroupMemberLimitReached);
    expect(await membersOf(group.id)).toBe(MAX_GROUP_MEMBERS);
  });

  it('lets exactly one of two concurrent ghosts take the 50th seat', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    await fillTo(group.id, MAX_GROUP_MEMBERS - 1);

    const results = await Promise.allSettled([
      repository.addGhost({ groupId: group.id, displayName: 'A', limit: MAX_GROUP_MEMBERS }),
      repository.addGhost({ groupId: group.id, displayName: 'B', limit: MAX_GROUP_MEMBERS }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await membersOf(group.id)).toBe(MAX_GROUP_MEMBERS);
  });
});

describe('invitations', () => {
  it('adds the accepting user as a member', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const token = await invitation(group.id, await adminMemberId(group.id, ana));

    const member = await repository.acceptInvitation({
      tokenHash: token.hash,
      userId: bea,
      now: NOW,
      limit: 50,
    });

    expect(member).toMatchObject({ groupId: group.id, userId: bea, role: 'member' });
  });

  it('works up to its last second and fails from its expiry on (sad path after)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const cai = await newUserId(connection.db);
    const dan = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const expiresAt = new Date(NOW.getTime() + WEEK);
    const token = await invitation(group.id, await adminMemberId(group.id, ana), expiresAt);
    const accept = (userId: string, now: Date) =>
      repository.acceptInvitation({ tokenHash: token.hash, userId, now, limit: 50 });

    await expect(accept(bea, new Date(expiresAt.getTime() - SECOND))).resolves.toMatchObject({
      userId: bea,
    });
    await expect(accept(cai, expiresAt)).rejects.toBeInstanceOf(TokenInvalid);
    await expect(accept(dan, new Date(expiresAt.getTime() + SECOND))).rejects.toBeInstanceOf(
      TokenInvalid,
    );
    expect(await membersOf(group.id)).toBe(2);
  });

  it('fails with the same error for an unknown token (sad path)', async () => {
    const ana = await newUserId(connection.db);
    await newGroup(ana);

    await expect(
      repository.acceptInvitation({
        tokenHash: tokens.generate().hash,
        userId: ana,
        now: NOW,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(TokenInvalid);
  });

  it('refuses a user who is already a member and adds nothing (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const token = await invitation(group.id, await adminMemberId(group.id, ana));

    await expect(
      repository.acceptInvitation({ tokenHash: token.hash, userId: ana, now: NOW, limit: 50 }),
    ).rejects.toBeInstanceOf(GroupAlreadyMember);
    expect(await membersOf(group.id)).toBe(1);
  });

  it('reports a bad token before membership and membership before the limit (error order)', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const expiresAt = new Date(NOW.getTime() + WEEK);
    const token = await invitation(group.id, await adminMemberId(group.id, ana), expiresAt);
    await fillTo(group.id, MAX_GROUP_MEMBERS);

    await expect(
      repository.acceptInvitation({
        tokenHash: token.hash,
        userId: ana,
        now: expiresAt,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(TokenInvalid);
    await expect(
      repository.acceptInvitation({ tokenHash: token.hash, userId: ana, now: NOW, limit: 50 }),
    ).rejects.toBeInstanceOf(GroupAlreadyMember);
  });

  it('refuses the 51st member through an invitation (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const token = await invitation(group.id, await adminMemberId(group.id, ana));
    await fillTo(group.id, MAX_GROUP_MEMBERS);

    await expect(
      repository.acceptInvitation({ tokenHash: token.hash, userId: bea, now: NOW, limit: 50 }),
    ).rejects.toBeInstanceOf(GroupMemberLimitReached);
    expect(await repository.findMember(group.id, bea)).toBeNull();
  });

  it('lets exactly one of two concurrent accepts take the 50th seat', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const cai = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const token = await invitation(group.id, await adminMemberId(group.id, ana));
    await fillTo(group.id, MAX_GROUP_MEMBERS - 1);

    const results = await Promise.allSettled(
      [bea, cai].map((userId) =>
        repository.acceptInvitation({
          tokenHash: token.hash,
          userId,
          now: NOW,
          limit: MAX_GROUP_MEMBERS,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
      GroupMemberLimitReached,
    );
    expect(await membersOf(group.id)).toBe(MAX_GROUP_MEMBERS);
  });

  it('keeps one invitation per member: a new one replaces the previous', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const memberId = await adminMemberId(group.id, ana);
    const first = await invitation(group.id, memberId);
    const second = await invitation(group.id, memberId);

    expect(
      await scalar('select count(*) as n from group_invitations where group_id = $1', [group.id]),
    ).toBe(1);
    await expect(
      repository.acceptInvitation({ tokenHash: first.hash, userId: bea, now: NOW, limit: 50 }),
    ).rejects.toBeInstanceOf(TokenInvalid);
    await expect(
      repository.acceptInvitation({ tokenHash: second.hash, userId: bea, now: NOW, limit: 50 }),
    ).resolves.toMatchObject({ userId: bea });
  });

  it('stores the hash and never the raw token', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const memberId = await adminMemberId(group.id, ana);
    const invited = await invitation(group.id, memberId);
    const ghost = await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });
    const link = tokens.generate();
    await repository.replaceClaimLink({
      groupId: group.id,
      memberId: ghost.id,
      tokenHash: link.hash,
    });

    const invitations = await connection.pool.query<Record<string, unknown>>(
      'select * from group_invitations',
    );
    const claims = await connection.pool.query<Record<string, unknown>>(
      'select * from group_claim_links',
    );

    expect(invitations.rows[0]?.token_hash).toBe(invited.hash);
    expect(claims.rows[0]?.token_hash).toBe(link.hash);
    const everything = JSON.stringify([invitations.rows, claims.rows]);
    expect(everything).not.toContain(invited.raw);
    expect(everything).not.toContain(link.raw);
  });
});

describe('claim links', () => {
  async function ghostWithLink(admin: string) {
    const { group } = await newGroup(admin);
    const ghost = await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });
    const link = tokens.generate();
    await repository.replaceClaimLink({
      groupId: group.id,
      memberId: ghost.id,
      tokenHash: link.hash,
    });
    return { group, ghost, link };
  }

  it('keeps the member id and joined_at, sets the user and clears the display name', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group, ghost, link } = await ghostWithLink(ana);
    const before = await connection.pool.query<{ joined_at: Date }>(
      'select joined_at from group_members where id = $1',
      [ghost.id],
    );

    const claimed = await repository.claimGhost({ tokenHash: link.hash, userId: bea, now: NOW });

    expect(claimed).toMatchObject({ id: ghost.id, groupId: group.id, userId: bea, role: 'member' });
    const after = await connection.pool.query<{
      joined_at: Date;
      display_name: string | null;
      user_id: string;
    }>('select joined_at, display_name, user_id from group_members where id = $1', [ghost.id]);
    expect(after.rows[0]?.joined_at).toEqual(before.rows[0]?.joined_at);
    expect(after.rows[0]?.display_name).toBeNull();
    expect(after.rows[0]?.user_id).toBe(bea);
    expect((await repository.getGroup(group.id))?.members.map((m) => m.id)).toEqual([
      await adminMemberId(group.id, ana),
      ghost.id,
    ]);
  });

  it('marks the link used with the given time', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { link } = await ghostWithLink(ana);

    await repository.claimGhost({ tokenHash: link.hash, userId: bea, now: NOW });

    const row = await connection.pool.query<{ used_at: Date | null }>(
      'select used_at from group_claim_links where token_hash = $1',
      [link.hash],
    );
    expect(row.rows[0]?.used_at).toEqual(NOW);
  });

  it('refuses a used link and an unknown one with TokenInvalid (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const cai = await newUserId(connection.db);
    const { link } = await ghostWithLink(ana);
    await repository.claimGhost({ tokenHash: link.hash, userId: bea, now: NOW });

    await expect(
      repository.claimGhost({ tokenHash: link.hash, userId: cai, now: NOW }),
    ).rejects.toBeInstanceOf(TokenInvalid);
    await expect(
      repository.claimGhost({ tokenHash: tokens.generate().hash, userId: cai, now: NOW }),
    ).rejects.toBeInstanceOf(TokenInvalid);
  });

  it('rolls back when the user is already in the group and leaves the link unused (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group, ghost, link } = await ghostWithLink(ana);

    await expect(
      repository.claimGhost({ tokenHash: link.hash, userId: ana, now: NOW }),
    ).rejects.toBeInstanceOf(GroupAlreadyMember);

    const row = await connection.pool.query<{ used_at: Date | null }>(
      'select used_at from group_claim_links where token_hash = $1',
      [link.hash],
    );
    expect(row.rows[0]?.used_at).toBeNull();
    expect(await repository.findMemberById(group.id, ghost.id)).toMatchObject({
      userId: null,
      displayName: 'Pedro',
    });
    await expect(
      repository.claimGhost({ tokenHash: link.hash, userId: bea, now: NOW }),
    ).resolves.toMatchObject({ id: ghost.id, userId: bea });
  });

  it('lets exactly one of two concurrent claims win, the other gets TokenInvalid', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const cai = await newUserId(connection.db);
    const { ghost, link } = await ghostWithLink(ana);

    const results = await Promise.allSettled(
      [bea, cai].map((userId) => repository.claimGhost({ tokenHash: link.hash, userId, now: NOW })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(TokenInvalid);
    expect(
      await scalar(
        'select count(*) as n from group_members where id = $1 and user_id is not null',
        [ghost.id],
      ),
    ).toBe(1);
  });

  it('replaces the unused link of a ghost, revoking the previous one', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group, ghost, link } = await ghostWithLink(ana);
    const next = tokens.generate();

    await repository.replaceClaimLink({
      groupId: group.id,
      memberId: ghost.id,
      tokenHash: next.hash,
    });

    expect(
      await scalar('select count(*) as n from group_claim_links where member_id = $1', [ghost.id]),
    ).toBe(1);
    await expect(
      repository.claimGhost({ tokenHash: link.hash, userId: bea, now: NOW }),
    ).rejects.toBeInstanceOf(TokenInvalid);
    await expect(
      repository.claimGhost({ tokenHash: next.hash, userId: bea, now: NOW }),
    ).resolves.toMatchObject({ id: ghost.id });
  });
});

describe('roles and rate type', () => {
  it('promotes a registered member and refuses a ghost at the database (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const token = await invitation(group.id, await adminMemberId(group.id, ana));
    const member = await repository.acceptInvitation({
      tokenHash: token.hash,
      userId: bea,
      now: NOW,
      limit: 50,
    });
    const ghost = await repository.addGhost({ groupId: group.id, displayName: 'Pedro', limit: 50 });

    expect(await repository.setAdmin(group.id, member.id)).toMatchObject({ role: 'admin' });
    await expect(repository.setAdmin(group.id, ghost.id)).rejects.toThrow();
    expect(await repository.setAdmin(group.id, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('does not touch a member of another group (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const mine = await newGroup(ana);
    const theirs = await newGroup(bea);
    const theirMember = await adminMemberId(theirs.group.id, bea);

    expect(await repository.setAdmin(mine.group.id, theirMember)).toBeNull();
  });

  it('changes only the default rate type', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);

    const updated = await repository.setDefaultRateType(group.id, 'blue');

    expect(updated).toMatchObject({ id: group.id, name: 'Casa', defaultRateType: 'blue' });
    expect(
      await repository.setDefaultRateType('00000000-0000-4000-8000-000000000000', 'blue'),
    ).toBeNull();
  });
});

describe('categories', () => {
  const custom = (name: string): NewGroupCategory => ({
    defaultKey: null,
    name,
    icon: 'wallet',
    color: 'blue',
  });

  it('adds, renames, archives and restores a category', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const added = await repository.addCategory(group.id, custom('Mascotas'));

    const renamed = await repository.updateCategory(group.id, added.id, { name: 'Pets' });
    const archived = await repository.updateCategory(group.id, added.id, { archivedAt: NOW });
    const restored = await repository.updateCategory(group.id, added.id, { archivedAt: null });

    expect(renamed?.name).toBe('Pets');
    expect(archived?.archivedAt).toEqual(NOW);
    expect(restored?.archivedAt).toBeNull();
    expect((await repository.listCategories(group.id)).at(-1)?.id).toBe(added.id);
  });

  it('answers null for a category of another group (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const mine = await newGroup(ana);
    const theirs = await newGroup(ana);
    const added = await repository.addCategory(theirs.group.id, custom('Mascotas'));

    expect(await repository.updateCategory(mine.group.id, added.id, { name: 'X' })).toBeNull();
  });

  it('maps a name clash, ignoring case, to GroupCategoryNameTaken (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    await repository.addCategory(group.id, custom('Mascotas'));
    const other = await repository.addCategory(group.id, custom('Viajes'));

    await expect(repository.addCategory(group.id, custom('MASCOTAS'))).rejects.toBeInstanceOf(
      GroupCategoryNameTaken,
    );
    await expect(
      repository.updateCategory(group.id, other.id, { name: 'mascotas' }),
    ).rejects.toBeInstanceOf(GroupCategoryNameTaken);
  });

  it('rethrows an unexpected database error unchanged (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const { group } = await newGroup(ana);
    const [first] = defaultCategories();
    if (!first) throw new Error('No default categories');

    const error: unknown = await repository.addCategory(group.id, first).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GroupCategoryNameTaken);
  });
});
