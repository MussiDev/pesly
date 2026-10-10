import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, DEFAULT_CATEGORIES, defaultCategoryNames } from '@pesly/shared';
import {
  AddGhostMember,
  ClaimGhostMember,
  CreateClaimLink,
  CreateGroup,
  CreateGroupCategory,
  CreateInvitation,
  GetGroup,
  JoinGroup,
  ListGroupCategories,
  ListGroups,
  MakeAdmin,
  MAX_GROUP_MEMBERS,
  UpdateGroup,
  UpdateGroupCategory,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { DeterministicTokenSource, FakeClock, InMemoryGroupRepository } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let clock: FakeClock;
let tokens: DeterministicTokenSource;
let groups: InMemoryGroupRepository;
let createGroup: CreateGroup;
let listGroups: ListGroups;
let getGroup: GetGroup;
let updateGroup: UpdateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let addGhost: AddGhostMember;
let createClaimLink: CreateClaimLink;
let claimGhost: ClaimGhostMember;
let makeAdmin: MakeAdmin;
let listCategories: ListGroupCategories;
let createCategory: CreateGroupCategory;
let updateCategory: UpdateGroupCategory;

beforeEach(() => {
  clock = new FakeClock();
  tokens = new DeterministicTokenSource();
  groups = new InMemoryGroupRepository(clock);
  const deps = { groups, clock, tokens };
  createGroup = new CreateGroup(deps);
  listGroups = new ListGroups(deps);
  getGroup = new GetGroup(deps);
  updateGroup = new UpdateGroup(deps);
  createInvitation = new CreateInvitation(deps);
  joinGroup = new JoinGroup(deps);
  addGhost = new AddGhostMember(deps);
  createClaimLink = new CreateClaimLink(deps);
  claimGhost = new ClaimGhostMember(deps);
  makeAdmin = new MakeAdmin(deps);
  listCategories = new ListGroupCategories(deps);
  createCategory = new CreateGroupCategory(deps);
  updateCategory = new UpdateGroupCategory(deps);
});

async function newGroup(userId = ALICE): Promise<string> {
  const created = await createGroup.execute(userId, { name: 'Casa', defaultRateType: 'blue' });
  return created.group.id;
}

async function joinAs(userId: string, groupId: string, inviter = ALICE): Promise<void> {
  const invitation = await createInvitation.execute(inviter, groupId);
  await joinGroup.execute(userId, invitation.token);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('CreateGroup', () => {
  it('makes the creator the only member and an admin (AC-01)', async () => {
    const created = await createGroup.execute(ALICE, { name: 'Casa', defaultRateType: 'blue' });

    expect(created.role).toBe('admin');
    expect(created.memberCount).toBe(1);
    expect(created.group.defaultRateType).toBe('blue');
    const members = groups.membersOf(created.group.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: ALICE, role: 'admin', displayName: null });
  });

  it('copies the Appendix A top-level expense categories into the group (AC-03)', async () => {
    const groupId = await newGroup();

    const expected = DEFAULT_CATEGORIES.filter(
      (entry) => entry.parentKey === null && entry.kind === 'expense',
    ).map((entry) => entry.key);
    const stored = await groups.listCategories(groupId);
    expect(expected.length).toBeGreaterThan(0);
    expect(stored.map((category) => category.defaultKey).sort()).toEqual([...expected].sort());
    expect(stored.every((category) => category.name === null)).toBe(true);
  });
});

describe('invitations', () => {
  it('expire exactly 7 days after creation, to the second (AC-04)', async () => {
    const groupId = await newGroup();

    const invitation = await createInvitation.execute(ALICE, groupId);

    expect(invitation.expiresAt.getTime()).toBe(clock.now().getTime() + SEVEN_DAYS_MS);
    expect(invitation.token).toBe('raw-1');
    expect(groups.invitations[0]?.tokenHash).toBe('hash:raw-1');
  });

  it("a member's second invitation replaces the first, which then fails with 400 (AC-06)", async () => {
    const groupId = await newGroup();
    const first = await createInvitation.execute(ALICE, groupId);
    await createInvitation.execute(ALICE, groupId);

    expect(groups.invitations).toHaveLength(1);
    expect(await codeOf(joinGroup.execute(BOB, first.token))).toBe('TOKEN_INVALID');
    expect(groups.membersOf(groupId)).toHaveLength(1);
  });

  it('a valid one adds a member; an expired one fails with 400 and adds none (AC-05, AC-06)', async () => {
    const groupId = await newGroup();
    const invitation = await createInvitation.execute(ALICE, groupId);

    const joined = await joinGroup.execute(BOB, invitation.token);
    expect(joined.group.id).toBe(groupId);
    expect(joined.role).toBe('member');
    expect(joined.memberCount).toBe(2);

    clock.advance(SEVEN_DAYS_MS);
    expect(await codeOf(joinGroup.execute(CAROL, invitation.token))).toBe('TOKEN_INVALID');
    expect(groups.membersOf(groupId)).toHaveLength(2);
  });

  it('an unknown token fails with the same 400 (AC-06)', async () => {
    expect(await codeOf(joinGroup.execute(BOB, 'never-issued'))).toBe('TOKEN_INVALID');
  });

  it('accepting as a current member adds no second membership (AC-07)', async () => {
    const groupId = await newGroup();
    const invitation = await createInvitation.execute(ALICE, groupId);

    expect(await codeOf(joinGroup.execute(ALICE, invitation.token))).toBe('GROUP_ALREADY_MEMBER');
    expect(groups.membersOf(groupId)).toHaveLength(1);
  });

  it('the 51st member through an invitation is a 409 conflict (AC-08)', async () => {
    const groupId = await newGroup();
    for (let index = 1; index < MAX_GROUP_MEMBERS; index += 1) {
      groups.seedMember(groupId, null, `Ghost ${index}`);
    }
    const invitation = await createInvitation.execute(ALICE, groupId);

    expect(groups.membersOf(groupId)).toHaveLength(MAX_GROUP_MEMBERS);
    expect(await codeOf(joinGroup.execute(BOB, invitation.token))).toBe(
      'GROUP_MEMBER_LIMIT_REACHED',
    );
    expect(groups.membersOf(groupId)).toHaveLength(MAX_GROUP_MEMBERS);
  });
});

describe('ghost members', () => {
  it('adding "Pedro" creates a member without a user (AC-09)', async () => {
    const groupId = await newGroup();

    const pedro = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });

    expect(pedro).toMatchObject({ userId: null, displayName: 'Pedro', role: 'member' });
    expect(groups.membersOf(groupId)).toHaveLength(2);
  });

  it('the 51st member as a ghost is a 409 conflict (AC-10)', async () => {
    const groupId = await newGroup();
    for (let index = 1; index < MAX_GROUP_MEMBERS; index += 1) {
      groups.seedMember(groupId, null, `Ghost ${index}`);
    }

    expect(await codeOf(addGhost.execute(ALICE, groupId, { displayName: 'Extra' }))).toBe(
      'GROUP_MEMBER_LIMIT_REACHED',
    );
    expect(groups.membersOf(groupId)).toHaveLength(MAX_GROUP_MEMBERS);
  });

  it('a claim link is bound to its ghost and a new one replaces the previous (AC-11)', async () => {
    const groupId = await newGroup();
    const pedro = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
    const first = await createClaimLink.execute(ALICE, groupId, pedro.id);
    const second = await createClaimLink.execute(ALICE, groupId, pedro.id);

    expect(first.token).not.toBe(second.token);
    expect(groups.claimLinks).toHaveLength(1);
    expect(groups.claimLinks[0]).toMatchObject({ memberId: pedro.id, tokenHash: 'hash:raw-2' });
    expect(await codeOf(claimGhost.execute(BOB, first.token))).toBe('TOKEN_INVALID');
  });

  it('a claim link for a registered member or an unknown member answers 404 (AC-11)', async () => {
    const groupId = await newGroup();
    const alice = groups.membersOf(groupId)[0];

    expect(await codeOf(createClaimLink.execute(ALICE, groupId, alice?.id ?? ''))).toBe(
      'NOT_FOUND',
    );
    expect(
      await codeOf(createClaimLink.execute(ALICE, groupId, '99999999-9999-4999-8999-999999999999')),
    ).toBe('NOT_FOUND');
  });

  it('claiming keeps the member id and position, and a used link is refused (AC-12, AC-13)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);
    const pedro = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
    await addGhost.execute(ALICE, groupId, { displayName: 'Lola' });
    const before = groups.membersOf(groupId).map((m) => m.id);
    const link = await createClaimLink.execute(ALICE, groupId, pedro.id);

    const claimed = await claimGhost.execute(CAROL, link.token);

    expect(claimed.group.id).toBe(groupId);
    expect(claimed.memberCount).toBe(4);
    const after = groups.membersOf(groupId);
    expect(after.map((m) => m.id)).toEqual(before);
    expect(after[2]).toMatchObject({
      id: pedro.id,
      userId: CAROL,
      displayName: null,
      joinedAt: pedro.joinedAt,
    });
    expect(
      await codeOf(claimGhost.execute('44444444-4444-4444-8444-444444444444', link.token)),
    ).toBe('TOKEN_INVALID');
  });

  it('a current member claiming is refused and the ghost stays (AC-14)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);
    const pedro = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
    const link = await createClaimLink.execute(ALICE, groupId, pedro.id);

    expect(await codeOf(claimGhost.execute(BOB, link.token))).toBe('GROUP_ALREADY_MEMBER');

    const stillGhost = await groups.findMemberById(groupId, pedro.id);
    expect(stillGhost).toMatchObject({ userId: null, displayName: 'Pedro' });
    expect(groups.claimLinks[0]?.usedAt).toBeNull();
  });
});

describe('MakeAdmin', () => {
  it('works for an admin (AC-15)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);
    const bob = await groups.findMember(groupId, BOB);

    const promoted = await makeAdmin.execute(ALICE, groupId, bob?.id ?? '');

    expect(promoted.role).toBe('admin');
    expect((await groups.findMember(groupId, BOB))?.role).toBe('admin');
  });

  it('is 403 for a non-admin and 409 for a ghost (AC-16)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);
    const bob = await groups.findMember(groupId, BOB);
    const pedro = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });

    expect(await codeOf(makeAdmin.execute(BOB, groupId, bob?.id ?? ''))).toBe(
      'GROUP_ADMIN_REQUIRED',
    );
    expect(await codeOf(makeAdmin.execute(ALICE, groupId, pedro.id))).toBe(
      'GROUP_MEMBER_NOT_REGISTERED',
    );
    expect((await groups.findMemberById(groupId, pedro.id))?.role).toBe('member');
  });

  it('an unknown member id answers 404 (AC-15)', async () => {
    const groupId = await newGroup();

    expect(
      await codeOf(makeAdmin.execute(ALICE, groupId, '99999999-9999-4999-8999-999999999999')),
    ).toBe('NOT_FOUND');
  });
});

describe('UpdateGroup', () => {
  it('changes the default rate type for an admin (AC-17)', async () => {
    const groupId = await newGroup();

    const updated = await updateGroup.execute(ALICE, groupId, { defaultRateType: 'oficial' });

    expect(updated.group.defaultRateType).toBe('oficial');
    expect(groups.groups.get(groupId)?.defaultRateType).toBe('oficial');
  });

  it('is refused for a plain member (AC-18)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);

    expect(await codeOf(updateGroup.execute(BOB, groupId, { defaultRateType: 'oficial' }))).toBe(
      'GROUP_ADMIN_REQUIRED',
    );
    expect(groups.groups.get(groupId)?.defaultRateType).toBe('blue');
  });
});

describe('group categories', () => {
  const input = { name: 'Mascotas', icon: 'paw-print', color: 'orange' } as const;

  it('an admin adds, renames and archives; a member lists (AC-19)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);

    const created = await createCategory.execute(ALICE, groupId, input);
    expect(created).toMatchObject({ name: 'Mascotas', defaultKey: null, archivedAt: null });

    const renamed = await updateCategory.execute(ALICE, groupId, created.id, { name: 'Perros' });
    expect(renamed.name).toBe('Perros');

    const archived = await updateCategory.execute(ALICE, groupId, created.id, { archived: true });
    expect(archived.archivedAt).toEqual(clock.now());
    const restored = await updateCategory.execute(ALICE, groupId, created.id, { archived: false });
    expect(restored.archivedAt).toBeNull();

    const listed = await listCategories.execute(BOB, groupId);
    expect(listed.some((category) => category.id === created.id)).toBe(true);
  });

  it('is 403 for a plain member on add, rename and archive (AC-20)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);
    const [first] = await listCategories.execute(ALICE, groupId);

    expect(await codeOf(createCategory.execute(BOB, groupId, input))).toBe('GROUP_ADMIN_REQUIRED');
    expect(await codeOf(updateCategory.execute(BOB, groupId, first?.id ?? '', { name: 'X' }))).toBe(
      'GROUP_ADMIN_REQUIRED',
    );
    expect(
      await codeOf(updateCategory.execute(BOB, groupId, first?.id ?? '', { archived: true })),
    ).toBe('GROUP_ADMIN_REQUIRED');
  });

  it('a clashing name is a 409, in either language and ignoring case (AC-20)', async () => {
    const groupId = await newGroup();
    const names = defaultCategoryNames('food');
    const other = await createCategory.execute(ALICE, groupId, input);

    expect(await codeOf(createCategory.execute(ALICE, groupId, { ...input, name: names.es }))).toBe(
      'CATEGORY_NAME_TAKEN',
    );
    expect(
      await codeOf(
        createCategory.execute(ALICE, groupId, { ...input, name: names.en.toUpperCase() }),
      ),
    ).toBe('CATEGORY_NAME_TAKEN');
    expect(await codeOf(updateCategory.execute(ALICE, groupId, other.id, { name: names.en }))).toBe(
      'CATEGORY_NAME_TAKEN',
    );
  });

  it('renaming a category to its own name is not a clash (AC-20)', async () => {
    const groupId = await newGroup();
    const created = await createCategory.execute(ALICE, groupId, input);

    const same = await updateCategory.execute(ALICE, groupId, created.id, { name: 'mascotas' });

    expect(same.name).toBe('mascotas');
  });

  it('an unknown category answers 404 (AC-19)', async () => {
    const groupId = await newGroup();

    expect(
      await codeOf(
        updateCategory.execute(ALICE, groupId, '99999999-9999-4999-8999-999999999999', {
          name: 'X',
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('access to a group the caller is not in (AC-21)', () => {
  it('every use case answers 404, the same as for an unknown group', async () => {
    const groupId = await newGroup();
    const ghost = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
    const [category] = await listCategories.execute(ALICE, groupId);
    const unknown = '99999999-9999-4999-8999-999999999999';
    const calls = (id: string): Promise<unknown>[] => [
      getGroup.execute(BOB, id),
      updateGroup.execute(BOB, id, { defaultRateType: 'oficial' }),
      createInvitation.execute(BOB, id),
      addGhost.execute(BOB, id, { displayName: 'X' }),
      createClaimLink.execute(BOB, id, ghost.id),
      makeAdmin.execute(BOB, id, ghost.id),
      listCategories.execute(BOB, id),
      createCategory.execute(BOB, id, { name: 'X', icon: 'paw-print', color: 'orange' }),
      updateCategory.execute(BOB, id, category?.id ?? '', { name: 'X' }),
    ];

    for (const outcome of await Promise.allSettled([...calls(groupId), ...calls(unknown)])) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') expect(outcome.reason).toBeInstanceOf(ResourceNotFound);
    }
    expect(groups.membersOf(groupId)).toHaveLength(2);
  });
});

describe('ListGroups and GetGroup', () => {
  it('the list holds only the caller groups (AC-22)', async () => {
    const aliceGroup = await newGroup(ALICE);
    const bobGroup = await newGroup(BOB);
    await joinAs(CAROL, aliceGroup);

    expect((await listGroups.execute(ALICE)).map((s) => s.group.id)).toEqual([aliceGroup]);
    expect((await listGroups.execute(BOB)).map((s) => s.group.id)).toEqual([bobGroup]);
    expect((await listGroups.execute(CAROL)).map((s) => s.group.id)).toEqual([aliceGroup]);
    expect(await listGroups.execute('55555555-5555-4555-8555-555555555555')).toEqual([]);
  });

  it('a member reads the group with its members and its own role (AC-22)', async () => {
    const groupId = await newGroup();
    await joinAs(BOB, groupId);

    const detail = await getGroup.execute(BOB, groupId);

    expect(detail.role).toBe('member');
    expect(detail.memberCount).toBe(2);
    expect(detail.members).toHaveLength(2);
  });
});
