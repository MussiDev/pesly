import { expenseOptionsResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
  type TestUser,
} from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function selfIdsOf(
  app: ReturnType<typeof setupGroupApi>['app'],
  user: TestUser,
  groupId: string,
) {
  const detail = await readGroup(app, user, groupId);
  const response = await call(app, 'get', `/groups/${groupId}/expense-options`, user.cookies);
  expect(response.status).toBe(200);
  const options = expenseOptionsResponseSchema.parse(response.body);
  return { detail, options };
}

describe('selfMemberId on group detail and expense options', () => {
  it('is the caller own member id, different for two members of one group', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const token = await invitationTokenOf(api.app, ana, group.id);
    expect((await call(api.app, 'post', '/groups/join', bob.cookies, { token })).status).toBe(200);

    const rows = await connection.pool.query<{ id: string; user_id: string }>(
      'select id, user_id from group_members where group_id = $1',
      [group.id],
    );
    const memberOf = (user: TestUser) => rows.rows.find((row) => row.user_id === user.id)?.id;

    const forAna = await selfIdsOf(api.app, ana, group.id);
    const forBob = await selfIdsOf(api.app, bob, group.id);

    expect(memberOf(ana)).toBeDefined();
    expect(forAna.detail.selfMemberId).toBe(memberOf(ana));
    expect(forAna.options.selfMemberId).toBe(memberOf(ana));
    expect(forBob.detail.selfMemberId).toBe(memberOf(bob));
    expect(forBob.options.selfMemberId).toBe(memberOf(bob));
    expect(forAna.detail.selfMemberId).not.toBe(forBob.detail.selfMemberId);
    expect(forAna.detail.members.map((member) => member.id)).toContain(
      forAna.detail.selfMemberId,
    );
  });

  it('is the ghost member id once the ghost is claimed', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    expect(ghost.status).toBe(201);
    const ghostId = (ghost.body as { id: string }).id;
    const link = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${ghostId}/claim-links`,
      ana.cookies,
    );
    expect(link.status).toBe(201);
    const claimed = await call(api.app, 'post', '/groups/claim', bob.cookies, {
      token: (link.body as { token: string }).token,
    });
    expect(claimed.status).toBe(200);

    const forBob = await selfIdsOf(api.app, bob, group.id);
    expect(forBob.detail.selfMemberId).toBe(ghostId);
    expect(forBob.options.selfMemberId).toBe(ghostId);
  });
});
