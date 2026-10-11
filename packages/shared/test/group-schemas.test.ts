import { describe, expect, it } from 'vitest';
import { accountNameSchema } from '../src/accounts/account';
import { ERROR_CODES } from '../src/errors';
import {
  addGhostMemberRequestSchema,
  claimGhostRequestSchema,
  createGroupCategoryRequestSchema,
  createGroupRequestSchema,
  groupCategoryParamsSchema,
  groupCategoryResponseSchema,
  groupDetailResponseSchema,
  groupIdParamsSchema,
  groupMemberParamsSchema,
  groupNameSchema,
  groupResponseSchema,
  invitationResponseSchema,
  joinGroupRequestSchema,
  updateGroupCategoryRequestSchema,
  updateGroupRequestSchema,
} from '../src/groups/group';

const UUID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const TOKEN = 'A'.repeat(43);
const NOW = '2026-10-10T12:00:00.000Z';

describe('group error codes', () => {
  it('declares the four group codes', () => {
    for (const code of [
      'GROUP_ADMIN_REQUIRED',
      'GROUP_ALREADY_MEMBER',
      'GROUP_MEMBER_LIMIT_REACHED',
      'GROUP_MEMBER_NOT_REGISTERED',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

describe('groupNameSchema and createGroupRequestSchema', () => {
  it('accepts a 50-character name and rejects a 51-character one (AC-02)', () => {
    const create = (name: string) =>
      createGroupRequestSchema.safeParse({ name, defaultRateType: 'blue' });
    expect(create('a'.repeat(50)).success).toBe(true);
    expect(create('a'.repeat(51)).success).toBe(false);
  });

  it.each(['', '   ', '​', '  '])('rejects the empty name %j (AC-02)', (name) => {
    expect(groupNameSchema.safeParse(name).success).toBe(false);
  });

  it('trims, normalizes to NFC and follows the account-name rules (AC-02)', () => {
    expect(groupNameSchema.parse('  Casa  ')).toBe('Casa');
    expect(groupNameSchema.parse('Café')).toBe('Café');
    for (const raw of ['a\u0007b', 'a‍b', 'a\tb']) {
      expect(groupNameSchema.safeParse(raw).success).toBe(accountNameSchema.safeParse(raw).success);
      expect(groupNameSchema.safeParse(raw).success).toBe(false);
    }
  });

  it('rejects unknown keys, a missing rate type and an invalid rate type (AC-02)', () => {
    expect(
      createGroupRequestSchema.safeParse({ name: 'Casa', defaultRateType: 'blue', extra: 1 })
        .success,
    ).toBe(false);
    expect(createGroupRequestSchema.safeParse({ name: 'Casa' }).success).toBe(false);
    expect(
      createGroupRequestSchema.safeParse({ name: 'Casa', defaultRateType: 'nope' }).success,
    ).toBe(false);
  });
});

describe('updateGroupRequestSchema', () => {
  it('requires the rate type and rejects an empty body or extra keys (AC-17)', () => {
    expect(updateGroupRequestSchema.safeParse({ defaultRateType: 'oficial' }).success).toBe(true);
    expect(updateGroupRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateGroupRequestSchema.safeParse({ defaultRateType: 'oficial', name: 'x' }).success,
    ).toBe(false);
  });
});

describe('addGhostMemberRequestSchema', () => {
  it('applies the group name rules to the display name (AC-09)', () => {
    expect(addGhostMemberRequestSchema.parse({ displayName: ' Pedro ' })).toEqual({
      displayName: 'Pedro',
    });
    expect(addGhostMemberRequestSchema.safeParse({ displayName: ' ' }).success).toBe(false);
    expect(addGhostMemberRequestSchema.safeParse({ displayName: 'a'.repeat(51) }).success).toBe(
      false,
    );
    expect(addGhostMemberRequestSchema.safeParse({ displayName: 'Pedro', x: 1 }).success).toBe(
      false,
    );
  });
});

describe.each([
  ['joinGroupRequestSchema', joinGroupRequestSchema],
  ['claimGhostRequestSchema', claimGhostRequestSchema],
])('%s', (_name, schema) => {
  it('accepts exactly 43 base64url characters (AC-05)', () => {
    expect(schema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(schema.safeParse({ token: `${'aZ09_-'.repeat(7)}a` }).success).toBe(true);
  });

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['plus sign', `${'A'.repeat(42)}+`],
    ['slash', `${'A'.repeat(42)}/`],
    ['padding', `${'A'.repeat(42)}=`],
    ['space', `${'A'.repeat(42)} `],
    ['newline suffix', `${'A'.repeat(43)}\n`],
    ['non-ASCII', `${'A'.repeat(42)}é`],
  ])('rejects a token that is %s (AC-05)', (_label, token) => {
    expect(schema.safeParse({ token }).success).toBe(false);
  });

  it('rejects a missing token, a non-string token and extra keys (AC-05)', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ token: 5 }).success).toBe(false);
    expect(schema.safeParse({ token: TOKEN, extra: true }).success).toBe(false);
  });
});

describe('params schemas', () => {
  it('require uuids', () => {
    expect(groupIdParamsSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(groupIdParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(groupMemberParamsSchema.safeParse({ id: UUID, memberId: UUID }).success).toBe(true);
    expect(groupMemberParamsSchema.safeParse({ id: UUID, memberId: 'x' }).success).toBe(false);
    expect(groupCategoryParamsSchema.safeParse({ id: UUID, categoryId: UUID }).success).toBe(true);
    expect(groupCategoryParamsSchema.safeParse({ id: UUID }).success).toBe(false);
  });
});

describe('group category schemas', () => {
  it('validates the create body with the category name, icon and color (AC-19)', () => {
    expect(
      createGroupCategoryRequestSchema.parse({ name: ' Asado ', icon: 'utensils', color: 'red' }),
    ).toEqual({ name: 'Asado', icon: 'utensils', color: 'red' });
    expect(
      createGroupCategoryRequestSchema.safeParse({ name: 'x', icon: 'nope', color: 'red' }).success,
    ).toBe(false);
    expect(
      createGroupCategoryRequestSchema.safeParse({ name: 'x', icon: 'car', color: 'nope' }).success,
    ).toBe(false);
    expect(
      createGroupCategoryRequestSchema.safeParse({
        name: 'x',
        icon: 'car',
        color: 'red',
        kind: 'expense',
      }).success,
    ).toBe(false);
  });

  it('rejects an update body with no key and extra keys (AC-17)', () => {
    expect(updateGroupCategoryRequestSchema.safeParse({}).success).toBe(false);
    expect(updateGroupCategoryRequestSchema.safeParse({ name: 'x', extra: 1 }).success).toBe(false);
    expect(updateGroupCategoryRequestSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateGroupCategoryRequestSchema.safeParse({ archived: 'yes' }).success).toBe(false);
    expect(updateGroupCategoryRequestSchema.safeParse({ color: 'blue', name: ' B ' }).data).toEqual(
      { color: 'blue', name: 'B' },
    );
  });
});

describe('response schemas', () => {
  const group = {
    id: UUID,
    name: 'Casa',
    defaultRateType: 'blue',
    role: 'admin',
    memberCount: 1,
    createdAt: NOW,
  };

  it('accepts a group and a detail with a registered and a ghost member', () => {
    expect(groupResponseSchema.safeParse(group).success).toBe(true);
    expect(
      groupDetailResponseSchema.safeParse({
        ...group,
        members: [
          { id: UUID, displayName: null, isGhost: false, role: 'admin', joinedAt: NOW },
          { id: UUID, displayName: 'Pedro', isGhost: true, role: 'member', joinedAt: NOW },
        ],
        formerMembers: [],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown role and a detail without members', () => {
    expect(groupResponseSchema.safeParse({ ...group, role: 'owner' }).success).toBe(false);
    expect(groupDetailResponseSchema.safeParse(group).success).toBe(false);
  });

  it('accepts an invitation and a category response', () => {
    expect(invitationResponseSchema.safeParse({ token: TOKEN, expiresAt: NOW }).success).toBe(true);
    expect(
      groupCategoryResponseSchema.safeParse({
        id: UUID,
        defaultKey: null,
        name: 'Asado',
        icon: 'utensils',
        color: 'red',
        archivedAt: null,
      }).success,
    ).toBe(true);
  });
});
