import { createHash } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE } from '../../src/identity/domain/account-defaults';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  startFakeGoogleOidc,
  type FakeGoogleIdentity,
  type FakeGoogleOidc,
} from '../fixtures/fake-google-oidc';
import {
  createIdentityHarness,
  LINK_BASE_URL,
  type IdentityHarness,
} from '../helpers/identity-harness';
import {
  ACCESS_COOKIE,
  cookieHeader,
  DELETION_GRANT_COOKIE,
  deleteAccount,
  parseSetCookies,
  refresh,
  REFRESH_COOKIE,
  seedUser,
  sessionFrom,
  signIn,
  signOut,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { seedTwoFactor, totpNow, wrongTotp } from '../helpers/two-factor-client';

let connection: DatabaseConnection;
let google: FakeGoogleOidc;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  google = await startFakeGoogleOidc();
});

afterEach(() => {
  google.resetTokenOptions();
});

afterAll(async () => {
  await google.close();
  await connection.pool.end();
});

const BINDING_COOKIE = '__Secure-argent_oauth';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const DEVICE = { timeZone: 'America/Cordoba', language: 'en' };
const IP = '198.51.100.7';
const GINA: FakeGoogleIdentity = {
  sub: 'g-sub-gina',
  email: 'gina@gmail.com',
  emailVerified: true,
};
const HUGO: FakeGoogleIdentity = {
  sub: 'g-sub-hugo',
  email: 'hugo@gmail.com',
  emailVerified: true,
};
const PASSWORD = 'a long enough passphrase';
const READY_URL = `${LINK_BASE_URL}/en/settings/delete-account?reauth=ready`;
const FAILED_URL = `${LINK_BASE_URL}/en/settings/delete-account?reauth=failed`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function harnessFor(): IdentityHarness {
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    google,
    env: { TRUST_PROXY: '1' },
  });
  // Rate-limit windows are fixed 15 minutes: start at the top of one so no test crosses a boundary.
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
  return harness;
}

function bindingOf(response: Response): string {
  const cookie = parseSetCookies(response).get(BINDING_COOKIE);
  if (!cookie) throw new Error(`Response ${response.status} did not set the binding cookie`);
  return cookie.value;
}

function callback(harness: IdentityHarness, url: string, binding?: string) {
  const target = new URL(url);
  const call = request(harness.app).get(`${target.pathname}${target.search}`);
  if (binding !== undefined) call.set('Cookie', `${BINDING_COOKIE}=${binding}`);
  return call;
}

interface Member {
  userId: string;
  cookies: SessionCookies;
  identity: FakeGoogleIdentity;
}

/** A Google sign-in: creates the password-less user the first time, a new session family each time. */
async function googleSignIn(
  harness: IdentityHarness,
  identity: FakeGoogleIdentity,
): Promise<Member> {
  const started = await request(harness.app)
    .get('/auth/google/start')
    .query(DEVICE)
    .set('X-Forwarded-For', IP);
  const { continueUrl } = await google.consent(started.headers.location as string, identity);
  const response = await callback(harness, continueUrl, bindingOf(started));
  expect(response.status).toBe(302);
  const result = await connection.pool.query<{ id: string }>(
    'select id from users where email = $1',
    [identity.email],
  );
  return { userId: result.rows[0]?.id ?? '', cookies: sessionFrom(response), identity };
}

function startReauth(
  harness: IdentityHarness,
  cookies: Partial<SessionCookies>,
  { ip = IP, extraCookie }: { ip?: string; extraCookie?: string } = {},
) {
  const header = [cookieHeader(cookies), extraCookie].filter(Boolean).join('; ');
  const call = request(harness.app)
    .post('/profile/delete/google/start')
    .set(trustedHeaders)
    .set('X-Forwarded-For', ip);
  if (header) call.set('Cookie', header);
  return call.send({});
}

function authorizationUrlOf(response: Response): string {
  return (response.body as { authorizationUrl: string }).authorizationUrl;
}

interface Prepared {
  continueUrl: string;
  cancelUrl: string;
  binding: string;
  authorizationUrl: string;
}

/** The start plus the fake consent page, stopping just before the callback. */
async function prepareReauth(
  harness: IdentityHarness,
  member: Member,
  identity: FakeGoogleIdentity = member.identity,
): Promise<Prepared> {
  const started = await startReauth(harness, member.cookies);
  expect(started.status).toBe(200);
  const authorizationUrl = authorizationUrlOf(started);
  const links = await google.consent(authorizationUrl, identity);
  return { ...links, binding: bindingOf(started), authorizationUrl };
}

async function reauthenticate(
  harness: IdentityHarness,
  member: Member,
  identity: FakeGoogleIdentity = member.identity,
): Promise<Response> {
  const { continueUrl, binding } = await prepareReauth(harness, member, identity);
  return callback(harness, continueUrl, binding);
}

function grantTokenOf(response: Response): string {
  const cookie = parseSetCookies(response).get(DELETION_GRANT_COOKIE);
  if (!cookie?.value) throw new Error(`Response ${response.status} did not set the grant cookie`);
  return cookie.value;
}

async function rows<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await connection.pool.query<T>(sql, params)).rows;
}

async function count(table: string): Promise<number> {
  return Number((await rows<{ n: string }>(`select count(*) as n from ${table}`))[0]?.n);
}

const userExists = async (userId: string): Promise<boolean> =>
  (await rows('select 1 from users where id = $1', [userId])).length === 1;

async function familyOf(member: Member): Promise<string> {
  const result = await rows<{ family_id: string }>(
    'select family_id from sessions where user_id = $1 order by created_at desc limit 1',
    [member.userId],
  );
  return result[0]?.family_id ?? '';
}

function codeOf(response: Response): unknown {
  return (response.body as { code?: unknown }).code;
}

function expectNoGrant(response: Response) {
  expect(parseSetCookies(response).has(DELETION_GRANT_COOKIE)).toBe(false);
  expect(parseSetCookies(response).has(ACCESS_COOKIE)).toBe(false);
  expect(parseSetCookies(response).has(REFRESH_COOKIE)).toBe(false);
}

describe('POST /profile/delete/google/start', () => {
  it('answers 200 with a fresh-login authorization URL, sets the binding cookie and stores a delete_account state (AC-06)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);

    const response = await startReauth(harness, member.cookies);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const url = new URL(authorizationUrlOf(response));
    expect(`${url.origin}${url.pathname}`).toBe(google.authorizationUrl);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('0');
    const binding = parseSetCookies(response).get(BINDING_COOKIE);
    expect(binding?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(binding?.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Lax',
      path: '/auth/google',
      'max-age': '600',
    });

    const [state] = await rows<Record<string, unknown>>('select * from oauth_states');
    expect(state).toMatchObject({
      purpose: 'delete_account',
      user_id: member.userId,
      session_family_id: await familyOf(member),
      state_hash: sha256(url.searchParams.get('state') ?? ''),
      binding_hash: sha256(binding?.value ?? ''),
      time_zone: 'America/Argentina/Cordoba',
      language: 'en',
    });
    expect((state?.expires_at as Date).getTime()).toBe(harness.clock.now().getTime() + 600_000);
  });

  it('shows the fake Google server prompt=login and max_age=0 on the authorization request (NFR-04)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const before = google.authorizationRequests.length;

    await prepareReauth(harness, member);

    const requests = google.authorizationRequests.slice(before);
    expect(requests.length).toBeGreaterThan(0);
    for (const seen of requests) expect(seen).toMatchObject({ prompt: 'login', max_age: '0' });
  });

  it('ignores a grant cookie that the request carries', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);

    const response = await startReauth(harness, member.cookies, {
      extraCookie: `${DELETION_GRANT_COOKIE}=whatever`,
    });

    expect(response.status).toBe(200);
  });

  it('answers 400 VALIDATION_FAILED for a user with a password and stores nothing (AC-10, sad path)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: 'pat@example.com', password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, 'pat@example.com', PASSWORD));

    const response = await startReauth(harness, cookies);

    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('VALIDATION_FAILED');
    expect(await count('oauth_states')).toBe(0);
    expect(parseSetCookies(response).has(BINDING_COOKIE)).toBe(false);
  });

  it('answers 401 without a session and stores nothing (sad path)', async () => {
    const harness = harnessFor();

    const response = await startReauth(harness, {});

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('UNAUTHENTICATED');
    expect(await count('oauth_states')).toBe(0);
  });

  it('answers 429 over the per-IP limit of Google starts (A-8, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);

    for (let n = 0; n < 20; n += 1) {
      expect((await startReauth(harness, member.cookies, { ip: '203.0.113.9' })).status).toBe(200);
    }
    const limited = await startReauth(harness, member.cookies, { ip: '203.0.113.9' });

    expect(limited.status).toBe(429);
    expect(codeOf(limited)).toBe('RATE_LIMITED');
    expect(await count('oauth_states')).toBe(20);
  });
});

describe('GET /auth/google/callback for a delete_account state', () => {
  it('issues a grant, sets its cookie and redirects to ?reauth=ready, with no session and no new account (AC-06)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const sessionsBefore = await count('sessions');

    const response = await reauthenticate(harness, member);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(READY_URL);
    const cookie = parseSetCookies(response).get(DELETION_GRANT_COOKIE);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Strict',
      path: '/profile/delete',
      'max-age': '300',
    });
    expect(parseSetCookies(response).get(BINDING_COOKIE)?.value).toBe('');
    expect(parseSetCookies(response).has(ACCESS_COOKIE)).toBe(false);
    expect(parseSetCookies(response).has(REFRESH_COOKIE)).toBe(false);

    const grants = await rows<Record<string, unknown>>('select * from deletion_grants');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      token_hash: sha256(cookie?.value ?? ''),
      user_id: member.userId,
      session_family_id: await familyOf(member),
      credentials_version: (
        await rows<{ credentials_version: number }>(
          'select credentials_version from users where id = $1',
          [member.userId],
        )
      )[0]?.credentials_version,
    });
    expect((grants[0]?.expires_at as Date).getTime()).toBe(
      harness.clock.now().getTime() + FIVE_MINUTES,
    );
    expect(JSON.stringify(grants)).not.toContain(cookie?.value ?? '');
    expect(await count('sessions')).toBe(sessionsBefore);
    expect(await count('users')).toBe(1);
    expect(await count('oauth_states')).toBe(0);
  });

  it('keeps one live grant per user when the user re-authenticates again (NFR-03)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);

    const first = grantTokenOf(await reauthenticate(harness, member));
    const second = grantTokenOf(await reauthenticate(harness, member));

    expect(await count('deletion_grants')).toBe(1);
    const replaced = await deleteAccount(harness.app, member.cookies, { grantToken: first });
    expect(replaced.status).toBe(401);
    expect(codeOf(replaced)).toBe('REAUTHENTICATION_REQUIRED');
    expect(await userExists(member.userId)).toBe(true);
    expect(second).not.toBe(first);
  });

  it.each([
    [
      'a different Google account',
      { sub: 'g-sub-other', email: 'other@gmail.com', emailVerified: true },
    ],
    [
      'another Google subject that claims the same address',
      { sub: 'g-sub-impostor', email: GINA.email, emailVerified: true },
    ],
    [
      'a Google account with an unverified email that is linked to nobody',
      { sub: 'g-sub-unverified', email: 'fresh@gmail.com', emailVerified: false },
    ],
  ])(
    'issues no grant for %s and resolves no account (AC-07, sad path)',
    async (_label, identity) => {
      const harness = harnessFor();
      const member = await googleSignIn(harness, GINA);
      const [usersBefore, identitiesBefore] = [
        await count('users'),
        await count('user_identities'),
      ];
      const sessionsBefore = await count('sessions');

      const response = await reauthenticate(harness, member, identity);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(FAILED_URL);
      expectNoGrant(response);
      expect(await count('deletion_grants')).toBe(0);
      expect(await count('users')).toBe(usersBefore);
      expect(await count('user_identities')).toBe(identitiesBefore);
      expect(await count('sessions')).toBe(sessionsBefore);
    },
  );

  it('redirects with ?reauth=failed when the user cancels or Google reports an error (AC-07, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const { cancelUrl, binding } = await prepareReauth(harness, member);

    const response = await callback(harness, cancelUrl, binding);

    expect(response.headers.location).toBe(FAILED_URL);
    expectNoGrant(response);
    expect(await count('deletion_grants')).toBe(0);
  });

  it('redirects with ?reauth=failed when the token exchange fails (AC-07, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const { continueUrl, binding } = await prepareReauth(harness, member);
    google.setTokenOptions({ signWithForeignKey: true });

    const response = await callback(harness, continueUrl, binding);

    expect(response.headers.location).toBe(FAILED_URL);
    expectNoGrant(response);
  });

  it('redirects as a failed sign-in for a wrong or missing binding cookie, and the state is not spent (A-11, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const { continueUrl, binding } = await prepareReauth(harness, member);

    const wrong = await callback(harness, continueUrl, `${binding.slice(1)}x`);
    const missing = await callback(harness, continueUrl);

    for (const response of [wrong, missing]) {
      expect(response.headers.location).toBe(
        `${LINK_BASE_URL}/${DEFAULT_LANGUAGE}/sign-in?error=google_failed`,
      );
      expectNoGrant(response);
    }
    expect(await count('deletion_grants')).toBe(0);
    expect(await count('oauth_states')).toBe(1);
  });

  it('redirects as a failed sign-in for an unknown, used or expired state (A-11, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const signInFailure = `${LINK_BASE_URL}/${DEFAULT_LANGUAGE}/sign-in?error=google_failed`;

    const used = await prepareReauth(harness, member);
    expect((await callback(harness, used.continueUrl, used.binding)).headers.location).toBe(
      READY_URL,
    );
    await connection.pool.query('delete from deletion_grants');
    const replay = await callback(harness, used.continueUrl, used.binding);

    const expired = await prepareReauth(harness, member);
    harness.clock.advance(10 * 60 * 1000 + 1000);
    const late = await callback(harness, expired.continueUrl, expired.binding);

    const unknown = await callback(
      harness,
      `${LINK_BASE_URL}/auth/google/callback?state=never-issued&code=c`,
      'some-binding',
    );

    for (const response of [replay, late, unknown]) {
      expect(response.headers.location).toBe(signInFailure);
      expectNoGrant(response);
    }
    expect(await count('deletion_grants')).toBe(0);
  });

  it('refuses an auth_time older than the state and one in the future (NFR-04, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const futureSeconds = Math.floor(harness.clock.now().getTime() / 1000) + 600;

    for (const authTime of [nowSeconds - 600, futureSeconds]) {
      google.setTokenOptions({ authTime });
      const response = await reauthenticate(harness, member);

      expect(response.headers.location).toBe(FAILED_URL);
      expectNoGrant(response);
    }
    expect(await count('deletion_grants')).toBe(0);
  });

  it('accepts an ID token without auth_time when the state is fresh, and one with a current auth_time (NFR-04)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);

    google.setTokenOptions({ authTime: null });
    const without = await reauthenticate(harness, member);
    google.setTokenOptions({ authTime: Math.floor(Date.now() / 1000) });
    const current = await reauthenticate(harness, member);

    expect(without.headers.location).toBe(READY_URL);
    expect(current.headers.location).toBe(READY_URL);
  });

  it('issues no grant when the session family that started it was signed out meanwhile (AC-07, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const prepared = await prepareReauth(harness, member);
    expect((await signOut(harness.app, member.cookies)).status).toBe(204);

    const response = await callback(harness, prepared.continueUrl, prepared.binding);

    expect(response.headers.location).toBe(FAILED_URL);
    expectNoGrant(response);
    expect(await count('deletion_grants')).toBe(0);
  });

  it('does not sign in or issue a grant when a sign-in state completes (AC-07)', async () => {
    const harness = harnessFor();
    await googleSignIn(harness, GINA);
    await googleSignIn(harness, GINA);

    expect(await count('deletion_grants')).toBe(0);
  });
});

describe('POST /profile/delete with a Google re-authentication grant', () => {
  it('deletes the account, consumes the grant and clears the session and grant cookies (AC-08)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const other = await googleSignIn(harness, HUGO);
    const grantToken = grantTokenOf(await reauthenticate(harness, member));

    const response = await deleteAccount(harness.app, member.cookies, { grantToken });

    expect(response.status).toBe(204);
    const cleared = parseSetCookies(response);
    expect(cleared.get(ACCESS_COOKIE)?.value).toBe('');
    expect(cleared.get(REFRESH_COOKIE)?.value).toBe('');
    expect(cleared.get(DELETION_GRANT_COOKIE)?.value).toBe('');
    expect(await userExists(member.userId)).toBe(false);
    expect(
      await rows('select 1 from deletion_grants where token_hash = $1', [sha256(grantToken)]),
    ).toEqual([]);
    expect(await userExists(other.userId)).toBe(true);
    expect((await refresh(harness.app, member.cookies)).status).toBe(401);
  });

  it('survives a token refresh: the session id rotates between the start, the callback and the deletion (AC-08)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const family = await familyOf(member);
    const started = await startReauth(harness, member.cookies);
    const links = await google.consent(authorizationUrlOf(started), member.identity);

    const first = await refresh(harness.app, member.cookies);
    expect(first.status).toBe(200);
    const rotated = sessionFrom(first);
    const callbackResponse = await callback(harness, links.continueUrl, bindingOf(started));
    expect(callbackResponse.headers.location).toBe(READY_URL);
    const second = await refresh(harness.app, rotated);
    expect(second.status).toBe(200);
    const latest = sessionFrom(second);

    expect(latest.refreshToken).not.toBe(member.cookies.refreshToken);
    const sessionIds = await rows<{ id: string; family_id: string }>(
      'select id, family_id from sessions where user_id = $1',
      [member.userId],
    );
    expect(new Set(sessionIds.map((row) => row.id)).size).toBe(3);
    expect(new Set(sessionIds.map((row) => row.family_id))).toEqual(new Set([family]));

    const response = await deleteAccount(harness.app, latest, {
      grantToken: grantTokenOf(callbackResponse),
    });

    expect(response.status).toBe(204);
    expect(await userExists(member.userId)).toBe(false);
  });

  it('needs the second factor too: a wrong or missing code gets 400, keeps the account and the grant (AC-08, AC-04, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const twoFactor = await seedTwoFactor(connection, member.userId, harness.clock);
    const grantToken = grantTokenOf(await reauthenticate(harness, member));

    const wrong = await deleteAccount(harness.app, member.cookies, {
      grantToken,
      body: { secondFactorCode: wrongTotp(twoFactor.secret, harness.clock) },
    });
    const missing = await deleteAccount(harness.app, member.cookies, { grantToken });

    for (const response of [wrong, missing]) {
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('TOTP_INVALID');
    }
    expect(await userExists(member.userId)).toBe(true);
    expect(await count('deletion_grants')).toBe(1);

    const right = await deleteAccount(harness.app, member.cookies, {
      grantToken,
      body: { secondFactorCode: totpNow(twoFactor.secret, harness.clock) },
    });

    expect(right.status).toBe(204);
    expect(await userExists(member.userId)).toBe(false);
  });

  it('answers 401 REAUTHENTICATION_REQUIRED for an expired grant and deletes nothing (AC-09, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const grantToken = grantTokenOf(await reauthenticate(harness, member));
    harness.clock.advance(FIVE_MINUTES + 1000);

    const response = await deleteAccount(harness.app, member.cookies, { grantToken });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('REAUTHENTICATION_REQUIRED');
    expect(await userExists(member.userId)).toBe(true);
  });

  it('answers 401 REAUTHENTICATION_REQUIRED for the grant of another user and deletes neither account (AC-09, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const other = await googleSignIn(harness, HUGO);
    const othersGrant = grantTokenOf(await reauthenticate(harness, other));

    const response = await deleteAccount(harness.app, member.cookies, { grantToken: othersGrant });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('REAUTHENTICATION_REQUIRED');
    expect(await userExists(member.userId)).toBe(true);
    expect(await userExists(other.userId)).toBe(true);
    expect(await count('deletion_grants')).toBe(1);
  });

  it('answers 401 REAUTHENTICATION_REQUIRED for a grant of another session family and deletes nothing (AC-09, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const memberFamily = await familyOf(member);
    const elsewhere = await googleSignIn(harness, GINA);
    expect(await familyOf(elsewhere)).not.toBe(memberFamily);
    const grantToken = grantTokenOf(await reauthenticate(harness, member));

    const response = await deleteAccount(harness.app, elsewhere.cookies, { grantToken });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('REAUTHENTICATION_REQUIRED');
    expect(await userExists(member.userId)).toBe(true);
  });

  it('answers 401 REAUTHENTICATION_REQUIRED without a grant cookie or with an unknown token, reserving nothing (AC-09, sad path)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const before = await count('auth_attempts');

    const missing = await deleteAccount(harness.app, member.cookies);
    const unknown = await deleteAccount(harness.app, member.cookies, { grantToken: 'not-a-grant' });

    for (const response of [missing, unknown]) {
      expect(response.status).toBe(401);
      expect(codeOf(response)).toBe('REAUTHENTICATION_REQUIRED');
    }
    expect(await userExists(member.userId)).toBe(true);
    expect(await count('auth_attempts')).toBe(before);
  });

  it('deletes once when two requests race with one grant, and the other answers 401 (AC-09, race)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const grantToken = grantTokenOf(await reauthenticate(harness, member));

    const responses = await Promise.all([
      deleteAccount(harness.app, member.cookies, { grantToken }),
      deleteAccount(harness.app, member.cookies, { grantToken }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 401]);
    expect(await userExists(member.userId)).toBe(false);
  });
});

describe('logs of the re-authentication', () => {
  it('carry ids and reasons, never the code, state, binding, tokens, claims, authorization URL or grant (NFR-04)', async () => {
    const harness = harnessFor();
    const member = await googleSignIn(harness, GINA);
    const started = await startReauth(harness, member.cookies);
    const authorizationUrl = authorizationUrlOf(started);
    const links = await google.consent(authorizationUrl, member.identity);
    const binding = bindingOf(started);
    const callbackResponse = await callback(harness, links.continueUrl, binding);
    const grantToken = grantTokenOf(callbackResponse);
    const failed = await reauthenticate(harness, member, HUGO);
    expect(failed.headers.location).toBe(FAILED_URL);
    const deleted = await deleteAccount(harness.app, member.cookies, { grantToken });
    expect(deleted.status).toBe(204);

    const url = new URL(authorizationUrl);
    const secrets = [
      authorizationUrl,
      url.searchParams.get('state') ?? '',
      url.searchParams.get('nonce') ?? '',
      url.searchParams.get('code_challenge') ?? '',
      new URL(links.continueUrl).searchParams.get('code') ?? '',
      binding,
      grantToken,
      GINA.email,
      GINA.sub,
      HUGO.sub,
    ];
    const logged = harness.lines.join('\n');
    for (const secret of secrets) expect(secret).not.toBe('');
    for (const secret of secrets) expect(logged).not.toContain(secret);
    expect(logged).toContain(member.userId);
    expect(logged).toContain('deletion re-authentication');
  });
});
