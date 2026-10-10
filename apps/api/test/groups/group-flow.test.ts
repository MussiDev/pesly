import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { cookieHeader, seedUser, type SessionCookies } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { testEnvSource, trustedHeaders } from '../helpers/test-env';
import {
  PASSWORD,
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
} from './routes-harness';

const DAY_MS = 24 * 60 * 60 * 1000;
const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));

let connection: DatabaseConnection;
const instances: ChildProcess[] = [];

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  for (const child of instances) child.kill();
  await connection.pool.end();
});

const codeOf = (body: unknown): string => (body as { code: string }).code;

/** Fills a group with ghost rows straight in the database, up to `total` members. */
async function fillWithGhosts(groupId: string, total: number): Promise<void> {
  await connection.pool.query(
    `insert into group_members (group_id, display_name)
     select $1, 'Ghost ' || n from generate_series(1, $2::int - (select count(*)::int from group_members where group_id = $1)) as n`,
    [groupId, total],
  );
}

describe('invitation flow (AC-04 to AC-08)', () => {
  it('joins with a link, lists both members, and refuses a repeated join with 409', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const token = await invitationTokenOf(api.app, ana, group.id);

    const joined = await call(api.app, 'post', '/groups/join', bob.cookies, { token });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ id: group.id, role: 'member', memberCount: 2 });

    const detail = await readGroup(api.app, ana, group.id);
    expect(detail.members.map((member) => member.role)).toEqual(['admin', 'member']);
    expect((await readGroup(api.app, bob, group.id)).memberCount).toBe(2);

    const again = await call(api.app, 'post', '/groups/join', bob.cookies, { token });
    expect(again.status).toBe(409);
    expect(codeOf(again.body)).toBe('GROUP_ALREADY_MEMBER');
    const asCreator = await call(api.app, 'post', '/groups/join', ana.cookies, { token });
    expect(asCreator.status).toBe(409);
    expect((await readGroup(api.app, ana, group.id)).members).toHaveLength(2);
  });

  it('works up to its last second and answers 400 one second after 7 days (AC-04, AC-06)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const cy = await api.makeUser('cy');
    const group = await createGroup(api.app, ana);
    const token = await invitationTokenOf(api.app, ana, group.id);

    api.clock.advance(7 * DAY_MS - 1000);
    expect((await call(api.app, 'post', '/groups/join', bob.cookies, { token })).status).toBe(200);

    api.clock.advance(2000);
    const expired = await call(api.app, 'post', '/groups/join', cy.cookies, { token });
    expect(expired.status).toBe(400);
    expect(codeOf(expired.body)).toBe('TOKEN_INVALID');
    expect((await readGroup(api.app, ana, group.id)).members).toHaveLength(2);
  });

  it('answers the same 400 to an unknown token (AC-05, AC-06)', async () => {
    const api = setupGroupApi(connection);
    const bob = await api.makeUser('bob');
    const response = await call(api.app, 'post', '/groups/join', bob.cookies, {
      token: 'A'.repeat(43),
    });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('TOKEN_INVALID');
  });

  it('a second invitation from the same member revokes the first (AC-06)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const first = await invitationTokenOf(api.app, ana, group.id);
    const second = await invitationTokenOf(api.app, ana, group.id);

    const old = await call(api.app, 'post', '/groups/join', bob.cookies, { token: first });
    expect(old.status).toBe(400);
    expect(
      (await call(api.app, 'post', '/groups/join', bob.cookies, { token: second })).status,
    ).toBe(200);
  });

  it('the invitation response carries the token and an expiry 7 days ahead', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const response = await call(api.app, 'post', `/groups/${group.id}/invitations`, ana.cookies);
    const body = response.body as { token: string; expiresAt: string };
    expect(body.token).toHaveLength(43);
    expect(new Date(body.expiresAt).getTime()).toBe(api.clock.now().getTime() + 7 * DAY_MS);
  });

  it.each([
    ['an empty body', {}],
    ['a short token', { token: 'abc' }],
    ['a token outside base64url', { token: '+'.repeat(43) }],
    ['a non-string token', { token: 7 }],
    ['an extra key', { token: 'A'.repeat(43), groupId: 'x' }],
  ])('rejects /groups/join and /groups/claim with %s with 400', async (_label, body) => {
    const api = setupGroupApi(connection);
    const bob = await api.makeUser('bob');
    for (const path of ['/groups/join', '/groups/claim']) {
      const response = await call(api.app, 'post', path, bob.cookies, body);
      expect(response.status, path).toBe(400);
      expect(codeOf(response.body)).toBe('VALIDATION_FAILED');
    }
  });

  it('an invitation cannot be made by a non-member, and /groups/join is not read as an id', async () => {
    const api = setupGroupApi(connection);
    const bob = await api.makeUser('bob');
    const response = await call(api.app, 'get', '/groups/join', bob.cookies);
    expect(response.status).toBe(400);
  });
});

describe('the 50-member limit (AC-08, AC-10)', () => {
  it('the 51st join answers 409 and adds nobody', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const token = await invitationTokenOf(api.app, ana, group.id);
    await fillWithGhosts(group.id, 50);

    const response = await call(api.app, 'post', '/groups/join', bob.cookies, { token });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('GROUP_MEMBER_LIMIT_REACHED');
    expect((await readGroup(api.app, ana, group.id)).memberCount).toBe(50);
  });

  it('the 51st ghost answers 409, the 50th is accepted', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    await fillWithGhosts(group.id, 49);

    const path = `/groups/${group.id}/ghost-members`;
    const fiftieth = await call(api.app, 'post', path, ana.cookies, { displayName: 'Fiftieth' });
    expect(fiftieth.status).toBe(201);
    const response = await call(api.app, 'post', path, ana.cookies, { displayName: 'Extra' });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('GROUP_MEMBER_LIMIT_REACHED');
    expect((await readGroup(api.app, ana, group.id)).memberCount).toBe(50);
  });

  it.each([
    ['an empty body', {}],
    ['an empty name', { displayName: '' }],
    ['a 51-character name', { displayName: 'p'.repeat(51) }],
    ['an extra key', { displayName: 'Pedro', userId: 'x' }],
  ])('rejects a ghost with %s with 400', async (_label, body) => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const response = await call(
      api.app,
      'post',
      `/groups/${group.id}/ghost-members`,
      ana.cookies,
      body,
    );
    expect(response.status).toBe(400);
  });
});

describe('ghost and claim flow (AC-09, AC-11 to AC-14)', () => {
  it('claims Pedro keeping his position, then the link answers 400', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const cy = await api.makeUser('cy');
    const group = await createGroup(api.app, ana);
    await joinAs(api, ana, cy, group.id);

    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    expect(ghost.status).toBe(201);
    expect(ghost.body).toMatchObject({ displayName: 'Pedro', isGhost: true, role: 'member' });
    const ghostId = (ghost.body as { id: string }).id;

    const before = await readGroup(api.app, ana, group.id);
    expect(before.members.map((member) => member.id).indexOf(ghostId)).toBe(2);

    const link = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${ghostId}/claim-links`,
      cy.cookies,
    );
    expect(link.status).toBe(201);
    const token = (link.body as { token: string }).token;
    expect(token).toHaveLength(43);

    const claimed = await call(api.app, 'post', '/groups/claim', bob.cookies, { token });
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({ id: group.id, role: 'member', memberCount: 3 });

    const after = await readGroup(api.app, ana, group.id);
    expect(after.members.map((member) => member.id)).toEqual(before.members.map((m) => m.id));
    const pedro = after.members.find((member) => member.id === ghostId);
    expect(pedro).toMatchObject({ isGhost: false, displayName: null });
    expect(pedro?.joinedAt).toBe(before.members[2]?.joinedAt);
    expect((await readGroup(api.app, bob, group.id)).memberCount).toBe(3);

    const reused = await call(api.app, 'post', '/groups/claim', bob.cookies, { token });
    expect(reused.status).toBe(400);
    expect(codeOf(reused.body)).toBe('TOKEN_INVALID');
  });

  it('a current member claiming answers 409 and the ghost stays a ghost (AC-14)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    const ghostId = (ghost.body as { id: string }).id;
    const link = await call(
      api.app,
      'post',
      `/groups/${group.id}/members/${ghostId}/claim-links`,
      ana.cookies,
    );
    const token = (link.body as { token: string }).token;

    const response = await call(api.app, 'post', '/groups/claim', ana.cookies, { token });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('GROUP_ALREADY_MEMBER');
    const detail = await readGroup(api.app, ana, group.id);
    expect(detail.members.find((member) => member.id === ghostId)?.isGhost).toBe(true);

    // The link stayed unused, so someone else can still claim with it.
    const bob = await api.makeUser('bob');
    expect((await call(api.app, 'post', '/groups/claim', bob.cookies, { token })).status).toBe(200);
  });

  it('a new claim link replaces the previous one (AC-11)', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName: 'Pedro',
    });
    const path = `/groups/${group.id}/members/${(ghost.body as { id: string }).id}/claim-links`;
    const first = (await call(api.app, 'post', path, ana.cookies)).body as { token: string };
    const second = (await call(api.app, 'post', path, ana.cookies)).body as { token: string };

    const old = await call(api.app, 'post', '/groups/claim', bob.cookies, { token: first.token });
    expect(old.status).toBe(400);
    expect(
      (await call(api.app, 'post', '/groups/claim', bob.cookies, { token: second.token })).status,
    ).toBe(200);
  });

  it('answers 400 to an unknown claim token', async () => {
    const api = setupGroupApi(connection);
    const bob = await api.makeUser('bob');
    const response = await call(api.app, 'post', '/groups/claim', bob.cookies, {
      token: 'B'.repeat(43),
    });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('TOKEN_INVALID');
  });
});

describe('no process state (stateless API)', () => {
  /** Starts `src/server.ts` in its own Node process, as `two-instances.test.ts` does. */
  async function startInstance(): Promise<string> {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => {
          if (address && typeof address === 'object') resolve(address.port);
          else reject(new Error('no port'));
        });
      });
    });
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: API_ROOT,
      env: { ...process.env, ...testEnvSource({ PORT: String(port), LOG_LEVEL: 'silent' }) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    instances.push(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`instance exited: ${stderr}`);
      try {
        if ((await fetch(`${baseUrl}/health`)).ok) return baseUrl;
      } catch {
        // Not listening yet: retried until the deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`instance did not start in time: ${stderr}`);
  }

  function send(
    baseUrl: string,
    method: string,
    path: string,
    cookies?: SessionCookies,
    body?: unknown,
  ) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...trustedHeaders,
        'Content-Type': 'application/json',
        ...(cookies ? { Cookie: cookieHeader(cookies) } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  }

  it('a second API instance sees a group created through the first, and the invitation joins there', async () => {
    const [instanceA, instanceB] = await Promise.all([startInstance(), startInstance()]);
    const anaEmail = 'ana@instances.test';
    const bobEmail = 'bob@instances.test';
    await seedUser(connection, { email: anaEmail, password: PASSWORD });
    await seedUser(connection, { email: bobEmail, password: PASSWORD });

    const cookiesOf = async (email: string): Promise<SessionCookies> => {
      const response = await send(instanceA, 'POST', '/auth/sign-in', undefined, {
        email,
        password: PASSWORD,
      });
      expect(response.status).toBe(200);
      const values = new Map<string, string>();
      for (const line of response.headers.getSetCookie()) {
        const [pair = ''] = line.split(';');
        const separator = pair.indexOf('=');
        values.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
      }
      return {
        accessToken: values.get('__Host-argent_at') ?? '',
        refreshToken: values.get('__Secure-argent_rt') ?? '',
      };
    };
    const ana = await cookiesOf(anaEmail);
    const bob = await cookiesOf(bobEmail);

    const created = await send(instanceA, 'POST', '/groups', ana, {
      name: 'Casa',
      defaultRateType: 'mep',
    });
    expect(created.status).toBe(201);
    const group = (await created.json()) as { id: string };

    const onB = await send(instanceB, 'GET', `/groups/${group.id}`, ana);
    expect(onB.status).toBe(200);
    expect(((await onB.json()) as { name: string }).name).toBe('Casa');

    const invitation = await send(instanceA, 'POST', `/groups/${group.id}/invitations`, ana);
    const { token } = (await invitation.json()) as { token: string };
    const joined = await send(instanceB, 'POST', '/groups/join', bob, { token });
    expect(joined.status).toBe(200);
    const listed = await send(instanceA, 'GET', '/groups', bob);
    expect(((await listed.json()) as { id: string }[]).map((item) => item.id)).toEqual([group.id]);
  }, 60_000);
});

async function joinAs(
  api: ReturnType<typeof setupGroupApi>,
  admin: Parameters<typeof invitationTokenOf>[1],
  user: Parameters<typeof invitationTokenOf>[1],
  groupId: string,
): Promise<void> {
  const token = await invitationTokenOf(api.app, admin, groupId);
  const joined = await call(api.app, 'post', '/groups/join', user.cookies, { token });
  expect(joined.status).toBe(200);
}
