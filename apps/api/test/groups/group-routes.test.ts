import { randomUUID } from 'node:crypto';
import {
  groupCategoryResponseSchema,
  groupDetailResponseSchema,
  groupResponseSchema,
  type GroupCategoryResponse,
} from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { seedUser, sessionFrom, signIn } from '../helpers/session-client';
import {
  PASSWORD,
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
  type Method,
  type TestUser,
} from './routes-harness';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function joinAs(
  api: ReturnType<typeof setupGroupApi>,
  admin: TestUser,
  user: TestUser,
  groupId: string,
) {
  const token = await invitationTokenOf(api.app, admin, groupId);
  const joined = await call(api.app, 'post', '/groups/join', user.cookies, { token });
  expect(joined.status).toBe(200);
}

describe('POST /groups, GET /groups, GET /groups/:id', () => {
  it('creates, lists and reads a group, the creator listed as its admin (AC-01, AC-03, AC-22)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');

    const created = await call(api.app, 'post', '/groups', ana.cookies, {
      name: 'Casa',
      defaultRateType: 'blue',
    });
    expect(created.status).toBe(201);
    const group = groupResponseSchema.parse(created.body);
    expect(group).toMatchObject({
      name: 'Casa',
      defaultRateType: 'blue',
      role: 'admin',
      memberCount: 1,
    });

    const listed = await call(api.app, 'get', '/groups', ana.cookies);
    expect(listed.status).toBe(200);
    expect((listed.body as unknown[]).map((item) => groupResponseSchema.parse(item).id)).toEqual([
      group.id,
    ]);
    const bobList = await call(api.app, 'get', '/groups', bob.cookies);
    expect(bobList.status).toBe(200);
    expect(bobList.body).toEqual([]);

    const detail = await readGroup(api.app, ana, group.id);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ role: 'admin', isGhost: false, displayName: null });

    const categories = await call(api.app, 'get', `/groups/${group.id}/categories`, ana.cookies);
    expect(categories.status).toBe(200);
    const names = (categories.body as unknown[]).map((item) =>
      groupCategoryResponseSchema.parse(item),
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((category) => category.defaultKey !== null)).toBe(true);
  });

  it.each([
    ['an empty object', {}],
    ['an empty name', { name: '', defaultRateType: 'mep' }],
    ['a whitespace-only name', { name: '   ', defaultRateType: 'mep' }],
    ['a 51-character name', { name: 'a'.repeat(51), defaultRateType: 'mep' }],
    ['an unknown rate type', { name: 'Casa', defaultRateType: 'nope' }],
    ['a missing rate type', { name: 'Casa' }],
    ['an extra key', { name: 'Casa', defaultRateType: 'mep', extra: 1 }],
    ['a non-string name', { name: 5, defaultRateType: 'mep' }],
  ])('rejects %s with 400 (AC-02)', async (_label, body) => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const response = await call(api.app, 'post', '/groups', ana.cookies, body);
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect((await call(api.app, 'get', '/groups', ana.cookies)).body).toEqual([]);
  });

  it('accepts a 50-character name (AC-02)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana, { name: 'a'.repeat(50), defaultRateType: 'mep' });
    expect(group.name).toHaveLength(50);
  });

  it('answers 400 to a malformed group id', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const response = await call(api.app, 'get', '/groups/not-a-uuid', ana.cookies);
    expect(response.status).toBe(400);
  });

  it('answers 401 without a session and 403 to an unverified email', async () => {
    const api = setupGroupApi(connection);
    expect((await call(api.app, 'get', '/groups')).status).toBe(401);
    expect((await call(api.app, 'post', '/groups/join', undefined, { token: 'x' })).status).toBe(
      401,
    );

    const email = 'eve@groups.test';
    await seedUser(connection, { email, password: PASSWORD, verified: false });
    const eve = sessionFrom(await signIn(api.app, email, PASSWORD));
    expect((await call(api.app, 'get', '/groups', eve)).status).toBe(403);
  });
});

describe('admin actions (AC-15 to AC-20)', () => {
  async function twoMembers() {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    await joinAs(api, ana, bob, group.id);
    const detail = await readGroup(api.app, ana, group.id);
    const bobMember = detail.members.find((member) => member.role === 'member');
    const anaMember = detail.members.find((member) => member.role === 'admin');
    if (!bobMember || !anaMember) throw new Error('members missing');
    return { api, ana, bob, group, bobMember, anaMember };
  }

  it('makes a member an admin: 403 for a plain member, 200 for an admin (AC-15, AC-16)', async () => {
    const { api, ana, bob, group, bobMember, anaMember } = await twoMembers();

    const denied = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${anaMember.id}/admin`,
      bob.cookies,
    );
    expect(denied.status).toBe(403);
    expect((denied.body as { code: string }).code).toBe('GROUP_ADMIN_REQUIRED');

    const promoted = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${bobMember.id}/admin`,
      ana.cookies,
    );
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ id: bobMember.id, role: 'admin', isGhost: false });

    // Bob is an admin now, so the same action no longer answers 403 for him.
    const again = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${anaMember.id}/admin`,
      bob.cookies,
    );
    expect(again.status).toBe(200);
  });

  it('refuses to make a ghost an admin with 409, and an unknown member is 404', async () => {
    const { api, ana, group } = await twoMembers();
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    expect(ghost.status).toBe(201);
    const ghostId = (ghost.body as { id: string }).id;

    const response = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${ghostId}/admin`,
      ana.cookies,
    );
    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('GROUP_MEMBER_NOT_REGISTERED');

    const unknown = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${randomUUID()}/admin`,
      ana.cookies,
    );
    expect(unknown.status).toBe(404);
  });

  it('changes the default rate type: 403 for a plain member, 200 for an admin (AC-17, AC-18)', async () => {
    const { api, ana, bob, group } = await twoMembers();

    const denied = await call(api.app, 'patch', `/groups/${group.id}`, bob.cookies, {
      defaultRateType: 'blue',
    });
    expect(denied.status).toBe(403);
    expect((await readGroup(api.app, ana, group.id)).defaultRateType).toBe('mep');

    const changed = await call(api.app, 'patch', `/groups/${group.id}`, ana.cookies, {
      defaultRateType: 'blue',
    });
    expect(changed.status).toBe(200);
    expect(groupResponseSchema.parse(changed.body).defaultRateType).toBe('blue');
    expect((await readGroup(api.app, bob, group.id)).defaultRateType).toBe('blue');
  });

  it.each([
    ['an empty body', {}],
    ['an unknown rate type', { defaultRateType: 'nope' }],
    ['an extra key', { defaultRateType: 'blue', name: 'Otra' }],
  ])('rejects a group update with %s with 400', async (_label, body) => {
    const { api, ana, group } = await twoMembers();
    const response = await call(api.app, 'patch', `/groups/${group.id}`, ana.cookies, body);
    expect(response.status).toBe(400);
  });

  it('adds, renames and archives categories: 403 for a plain member, 200 or 201 for an admin (AC-19, AC-20)', async () => {
    const { api, ana, bob, group } = await twoMembers();
    const path = `/groups/${group.id}/categories`;
    const body = { name: 'Mascotas', icon: 'utensils', color: 'orange' };

    const denied = await call(api.app, 'post', path, bob.cookies, body);
    expect(denied.status).toBe(403);

    const created = await call(api.app, 'post', path, ana.cookies, body);
    expect(created.status).toBe(201);
    const category = groupCategoryResponseSchema.parse(created.body);
    expect(category).toMatchObject({ name: 'Mascotas', defaultKey: null, archivedAt: null });

    const deniedPatch = await call(api.app, 'patch', `${path}/${category.id}`, bob.cookies, {
      name: 'Perros',
    });
    expect(deniedPatch.status).toBe(403);

    const renamed = await call(api.app, 'patch', `${path}/${category.id}`, ana.cookies, {
      name: 'Perros',
    });
    expect(renamed.status).toBe(200);
    expect(groupCategoryResponseSchema.parse(renamed.body).name).toBe('Perros');

    const archived = await call(api.app, 'patch', `${path}/${category.id}`, ana.cookies, {
      archived: true,
    });
    expect(archived.status).toBe(200);
    expect(groupCategoryResponseSchema.parse(archived.body).archivedAt).not.toBeNull();

    const restored = await call(api.app, 'patch', `${path}/${category.id}`, ana.cookies, {
      archived: false,
    });
    expect(groupCategoryResponseSchema.parse(restored.body).archivedAt).toBeNull();

    // Any member reads them, archived ones included.
    const listed = await call(api.app, 'get', path, bob.cookies);
    expect(listed.status).toBe(200);
    expect((listed.body as GroupCategoryResponse[]).some((item) => item.id === category.id)).toBe(
      true,
    );
  });

  it('refuses a category name that clashes with a default in either language with 409', async () => {
    const { api, ana, group } = await twoMembers();
    const path = `/groups/${group.id}/categories`;
    for (const name of ['Food', 'comida', 'FOOD']) {
      const response = await call(api.app, 'post', path, ana.cookies, {
        name,
        icon: 'utensils',
        color: 'orange',
      });
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('CATEGORY_NAME_TAKEN');
    }
    const ok = await call(api.app, 'post', path, ana.cookies, {
      name: 'Mascotas',
      icon: 'utensils',
      color: 'orange',
    });
    expect(ok.status).toBe(201);
    const clash = await call(api.app, 'post', path, ana.cookies, {
      name: 'mascotas',
      icon: 'utensils',
      color: 'orange',
    });
    expect(clash.status).toBe(409);
    const listed = (await call(api.app, 'get', path, ana.cookies)).body as GroupCategoryResponse[];
    const food = listed.find((item) => item.defaultKey === 'food');
    const rename = await call(
      api.app,
      'patch',
      `${path}/${(ok.body as { id: string }).id}`,
      ana.cookies,
      {
        name: 'Comida',
      },
    );
    expect(rename.status).toBe(409);
    expect(food).toBeDefined();
  });

  it.each([
    ['an empty body', {}],
    ['an invalid color', { color: 'chartreuse' }],
    ['an extra key', { name: 'Otra', kind: 'income' }],
    ['a non-boolean archived', { archived: 'yes' }],
  ])('rejects a category update with %s with 400', async (_label, body) => {
    const { api, ana, group } = await twoMembers();
    const categories = (await call(api.app, 'get', `/groups/${group.id}/categories`, ana.cookies))
      .body as GroupCategoryResponse[];
    const first = categories[0];
    if (!first) throw new Error('no categories');
    const response = await call(
      api.app,
      'patch',
      `/groups/${group.id}/categories/${first.id}`,
      ana.cookies,
      body,
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ['an empty name', { name: '', icon: 'utensils', color: 'orange' }],
    ['a missing color', { name: 'Mascotas', icon: 'utensils' }],
    ['an extra key', { name: 'Mascotas', icon: 'utensils', color: 'orange', kind: 'income' }],
  ])('rejects a category creation with %s with 400', async (_label, body) => {
    const { api, ana, group } = await twoMembers();
    const response = await call(
      api.app,
      'post',
      `/groups/${group.id}/categories`,
      ana.cookies,
      body,
    );
    expect(response.status).toBe(400);
  });

  it('an unknown category id is 404 for an admin', async () => {
    const { api, ana, group } = await twoMembers();
    const response = await call(
      api.app,
      'patch',
      `/groups/${group.id}/categories/${randomUUID()}`,
      ana.cookies,
      { archived: true },
    );
    expect(response.status).toBe(404);
  });
});

describe('non-members (AC-21)', () => {
  it('every group route answers 404 with the same body for a non-member and an unknown id', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const cy = await api.makeUser('cy');
    const group = await createGroup(api.app, ana);
    const detail = await readGroup(api.app, ana, group.id);
    const memberId = detail.members[0]?.id ?? '';
    const categories = (await call(api.app, 'get', `/groups/${group.id}/categories`, ana.cookies))
      .body as GroupCategoryResponse[];
    const categoryId = categories[0]?.id ?? '';

    const routes: {
      method: Method;
      path: (groupId: string, memberId: string, categoryId: string) => string;
      body?: Record<string, unknown>;
    }[] = [
      { method: 'get', path: (g) => `/groups/${g}` },
      { method: 'patch', path: (g) => `/groups/${g}`, body: { defaultRateType: 'blue' } },
      { method: 'post', path: (g) => `/groups/${g}/invitations` },
      { method: 'post', path: (g) => `/groups/${g}/ghost-members`, body: { displayName: 'Pedro' } },
      { method: 'post', path: (g, m) => `/groups/${g}/members/${m}/claim-links` },
      { method: 'post', path: (g, m) => `/groups/${g}/members/${m}/admin` },
      { method: 'get', path: (g) => `/groups/${g}/categories` },
      {
        method: 'post',
        path: (g) => `/groups/${g}/categories`,
        body: { name: 'Mascotas', icon: 'utensils', color: 'orange' },
      },
      {
        method: 'patch',
        path: (g, _m, c) => `/groups/${g}/categories/${c}`,
        body: { archived: true },
      },
    ];

    for (const route of routes) {
      const real = await call(
        api.app,
        route.method,
        route.path(group.id, memberId, categoryId),
        cy.cookies,
        route.body,
      );
      const unknown = await call(
        api.app,
        route.method,
        route.path(randomUUID(), randomUUID(), randomUUID()),
        cy.cookies,
        route.body,
      );
      expect(real.status, `${route.method} ${route.path(':id', ':memberId', ':categoryId')}`).toBe(
        404,
      );
      expect(unknown.status).toBe(404);
      expect(real.body).toEqual(unknown.body);
    }

    // Nothing changed behind the 404s.
    const after = await readGroup(api.app, ana, group.id);
    expect(after.members).toHaveLength(1);
    expect(after.defaultRateType).toBe('mep');
    expect((await call(api.app, 'get', '/groups', cy.cookies)).body).toEqual([]);
  });

  it('a claim link for a registered member is 404, as is a link for an unknown member', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const memberId = (await readGroup(api.app, ana, group.id)).members[0]?.id ?? '';
    for (const id of [memberId, randomUUID()]) {
      const response = await call(
        api.app,
        'post',
        `/groups/${group.id}/members/${id}/claim-links`,
        ana.cookies,
      );
      expect(response.status).toBe(404);
    }
  });
});

describe('member names and ids from another group (AC-09, AC-12, AC-21)', () => {
  it('shows a named user and a ghost by name, with no email and no user id', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    await connection.pool.query('update users set display_name = $1 where id = $2', [
      'Bob Builder',
      bob.id,
    ]);
    const group = await createGroup(api.app, ana);
    await joinAs(api, ana, bob, group.id);
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    expect(ghost.status).toBe(201);

    const response = await call(api.app, 'get', `/groups/${group.id}`, ana.cookies);
    expect(response.status).toBe(200);
    const detail = groupDetailResponseSchema.parse(response.body);

    const named = detail.members.find((member) => member.role === 'member' && !member.isGhost);
    expect(named?.displayName).toBe('Bob Builder');
    expect(detail.members.find((member) => member.isGhost)?.displayName).toBe('Pedro');
    for (const member of detail.members) {
      expect(Object.keys(member).sort()).toEqual([
        'displayName',
        'id',
        'isGhost',
        'joinedAt',
        'role',
      ]);
    }
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain(ana.id);
    expect(raw).not.toContain(bob.id);
  });

  it('a member id of another group is 404 like an unknown id, and changes nothing', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const groupA = await createGroup(api.app, ana);
    const groupB = await createGroup(api.app, bob);
    const ghostB = await call(api.app, 'post', `/groups/${groupB.id}/ghost-members`, bob.cookies, {
      displayName: 'Pedro',
    });
    expect(ghostB.status).toBe(201);
    const foreignIds = [
      (ghostB.body as { id: string }).id,
      (await readGroup(api.app, bob, groupB.id)).members[0]?.id ?? '',
    ];
    const countsBefore = await connection.pool.query<{ role: string; n: string }>(
      'select role, count(*) as n from group_members group by role order by role',
    );
    const linksBefore = await connection.pool.query('select 1 from group_claim_links');

    for (const action of ['admin', 'claim-links']) {
      const unknown = await call(
        api.app,
        'post',
        `/groups/${groupA.id}/members/${randomUUID()}/${action}`,
        ana.cookies,
      );
      expect(unknown.status).toBe(404);
      for (const foreignId of foreignIds) {
        const response = await call(
          api.app,
          'post',
          `/groups/${groupA.id}/members/${foreignId}/${action}`,
          ana.cookies,
        );
        expect(response.status, `${action} ${foreignId}`).toBe(404);
        expect(response.body).toEqual(unknown.body);
      }
    }

    const countsAfter = await connection.pool.query<{ role: string; n: string }>(
      'select role, count(*) as n from group_members group by role order by role',
    );
    expect(countsAfter.rows).toEqual(countsBefore.rows);
    expect(await connection.pool.query('select 1 from group_claim_links')).toHaveProperty(
      'rowCount',
      linksBefore.rowCount,
    );
    expect((await readGroup(api.app, ana, groupA.id)).members).toHaveLength(1);
    expect((await readGroup(api.app, bob, groupB.id)).members).toHaveLength(2);
  });
});

describe('what responses and logs may contain (NFR-02)', () => {
  it('no response has an email or a stored token hash, and no log line has a token', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);

    const bodies: unknown[] = [];
    const invitation = await call(api.app, 'post', `/groups/${group.id}/invitations`, ana.cookies);
    expect(invitation.status).toBe(201);
    bodies.push(invitation.body);
    const invitationToken = (invitation.body as { token: string }).token;

    const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
      token: invitationToken,
    });
    bodies.push(joined.body);

    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    bodies.push(ghost.body);
    const link = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${(ghost.body as { id: string }).id}/claim-links`,
      ana.cookies,
    );
    expect(link.status).toBe(201);
    bodies.push(link.body);
    const claimToken = (link.body as { token: string }).token;

    bodies.push((await call(api.app, 'get', '/groups', bob.cookies)).body);
    bodies.push((await call(api.app, 'get', `/groups/${group.id}`, ana.cookies)).body);
    bodies.push((await call(api.app, 'get', `/groups/${group.id}/categories`, ana.cookies)).body);
    // Rejected calls carry the token too: its failure must not echo it.
    const rejected = await call(api.app, 'post', '/groups/join', bob.cookies, {
      token: invitationToken,
    });
    expect(rejected.status).toBe(409);
    bodies.push(rejected.body);
    const claimed = await call(api.app, 'post', '/groups/claim', bob.cookies, {
      token: claimToken,
    });
    expect(claimed.status).toBe(409);
    bodies.push(claimed.body);

    const hashRows = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from group_invitations union all select token_hash from group_claim_links',
    );
    expect(hashRows.rows).toHaveLength(2);

    const everything = JSON.stringify(bodies);
    expect(everything).not.toContain('@');
    for (const row of hashRows.rows) expect(everything).not.toContain(row.token_hash);
    expect(groupDetailResponseSchema.safeParse(bodies[5]).success).toBe(true);

    const log = api.logLines().join('\n');
    expect(log).not.toContain(invitationToken);
    expect(log).not.toContain(claimToken);
    for (const row of hashRows.rows) expect(log).not.toContain(row.token_hash);
    expect(log).not.toContain('Pedro');
    expect(log).toContain(group.id);
  });
});
