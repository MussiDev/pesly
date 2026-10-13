import { createHash } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  type IdentityHarnessOptions,
} from '../helpers/identity-harness';
import {
  ACCESS_COOKIE,
  cookieHeader,
  currentSession,
  parseSetCookies,
  REFRESH_COOKIE,
  seedUser,
  sessionFrom,
  signIn,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

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
const PASSWORD = 'a long enough passphrase';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const DEVICE = { timeZone: 'America/Cordoba', language: 'en' };

function failureUrl(language: 'es' | 'en'): string {
  return `${LINK_BASE_URL}/${language}/sign-in?error=google_failed`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Real sessions, the fake Google server, and client IPs from X-Forwarded-For. */
function harnessFor(options: IdentityHarnessOptions = {}): IdentityHarness {
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    google,
    env: { TRUST_PROXY: '1' },
    ...options,
  });
  // Rate-limit windows are fixed 15 minutes: start at the top of one so no test crosses a boundary.
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
  return harness;
}

function start(
  harness: IdentityHarness,
  query: Record<string, string> | string = DEVICE,
  ip = '198.51.100.7',
) {
  return request(harness.app).get('/auth/google/start').query(query).set('X-Forwarded-For', ip);
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

interface PreparedCallback {
  continueUrl: string;
  cancelUrl: string;
  binding: string;
}

/** Start plus the fake consent page, stopping just before the callback. */
async function prepare(
  harness: IdentityHarness,
  identity: FakeGoogleIdentity,
  query: Record<string, string> = DEVICE,
): Promise<PreparedCallback> {
  const started = await start(harness, query);
  expect(started.status).toBe(302);
  const links = await google.consent(started.headers.location as string, identity);
  return { ...links, binding: bindingOf(started) };
}

async function googleSignIn(
  harness: IdentityHarness,
  identity: FakeGoogleIdentity,
  query: Record<string, string> = DEVICE,
): Promise<Response> {
  const { continueUrl, binding } = await prepare(harness, identity, query);
  return callback(harness, continueUrl, binding);
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  time_zone: string;
  language: string;
  credentials_version: number;
}

async function userRows(): Promise<UserRow[]> {
  const result = await connection.pool.query<UserRow>(
    `select id, email, password_hash, email_verified_at, time_zone, language, credentials_version
     from users order by email`,
  );
  return result.rows;
}

async function identityRows(): Promise<
  { user_id: string; subject: string; email_authoritative: boolean }[]
> {
  const result = await connection.pool.query<{
    user_id: string;
    subject: string;
    email_authoritative: boolean;
  }>('select user_id, subject, email_authoritative from user_identities order by subject');
  return result.rows;
}

async function stateRows(): Promise<Record<string, unknown>[]> {
  const result = await connection.pool.query<Record<string, unknown>>(
    'select * from oauth_states order by created_at',
  );
  return result.rows;
}

async function outboxCount(): Promise<number> {
  const result = await connection.pool.query<{ count: string }>(
    'select count(*) from email_outbox',
  );
  return Number(result.rows[0]?.count);
}

function expectNoSession(response: Response) {
  const cookies = parseSetCookies(response);
  expect(cookies.has(ACCESS_COOKIE)).toBe(false);
  expect(cookies.has(REFRESH_COOKIE)).toBe(false);
}

function expectBindingCleared(response: Response) {
  const binding = parseSetCookies(response).get(BINDING_COOKIE);
  expect(binding?.value).toBe('');
  expect(binding?.attributes.path).toBe('/auth/google');
  expect(new Date(String(binding?.attributes.expires)).getTime()).toBeLessThan(Date.now());
}

function gmail(sub: string, email: string, emailVerified = true): FakeGoogleIdentity {
  return { sub, email, emailVerified };
}

function named(identity: FakeGoogleIdentity, name: string): FakeGoogleIdentity {
  return { ...identity, name };
}

async function displayNameOf(email: string): Promise<string | null> {
  const result = await connection.pool.query<{ display_name: string | null }>(
    'select display_name from users where email = $1',
    [email],
  );
  return result.rows[0]?.display_name ?? null;
}

async function setDisplayName(userId: string, displayName: string): Promise<void> {
  await connection.pool.query('update users set display_name = $1 where id = $2', [
    displayName,
    userId,
  ]);
}

function profileOf(harness: IdentityHarness, response: Response) {
  return request(harness.app)
    .get('/profile')
    .set('Cookie', cookieHeader(sessionFrom(response)));
}

describe('GET /auth/google/start', () => {
  it('redirects to Google, stores one state with hashes only and sets the Lax binding cookie (FR-01)', async () => {
    const harness = harnessFor();

    const response = await start(harness);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(`${location.origin}${location.pathname}`).toBe(google.authorizationUrl);
    const state = location.searchParams.get('state') ?? '';
    const nonce = location.searchParams.get('nonce') ?? '';
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4000/auth/google/callback',
    );

    const binding = parseSetCookies(response).get(BINDING_COOKIE);
    expect(binding?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(binding?.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Lax',
      path: '/auth/google',
      'max-age': '600',
    });

    const rows = await stateRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? {};
    const verifier = String(row.code_verifier);
    expect(location.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(row).toMatchObject({
      state_hash: sha256(state),
      binding_hash: sha256(binding?.value ?? ''),
      nonce_hash: sha256(nonce),
      time_zone: 'America/Argentina/Cordoba',
      language: 'en',
    });
    expect((row.expires_at as Date).getTime()).toBe(harness.clock.now().getTime() + TEN_MINUTES);
    const stored = JSON.stringify(row);
    for (const secret of [state, nonce, binding?.value ?? '']) {
      expect(stored).not.toContain(secret);
    }
  });

  it('answers 400 VALIDATION_FAILED for a value over its length limit or a repeated parameter (sad path)', async () => {
    const harness = harnessFor();

    const longTimeZone = await start(harness, { timeZone: 'x'.repeat(65), language: 'en' });
    const longLanguage = await start(harness, { timeZone: 'UTC', language: 'e'.repeat(36) });
    const repeated = await start(harness, 'language=en&language=es');

    expect(longTimeZone.status).toBe(400);
    expect(longTimeZone.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['query.timeZone'] });
    expect(longLanguage.status).toBe(400);
    expect(longLanguage.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['query.language'] });
    expect(repeated.status).toBe(400);
    expect(await stateRows()).toEqual([]);
  });

  it('stores the defaults for an unknown time zone, an unknown language or empty values (sad path)', async () => {
    const harness = harnessFor();

    expect((await start(harness, { timeZone: 'Mars/Olympus', language: 'klingon' })).status).toBe(
      302,
    );
    expect((await start(harness, { timeZone: '', language: '' })).status).toBe(302);

    expect((await stateRows()).map((row) => [row.time_zone, row.language])).toEqual([
      ['America/Argentina/Buenos_Aires', 'es'],
      ['America/Argentina/Buenos_Aires', 'es'],
    ]);
  });

  it('redirects the 21st start from one IP within 15 minutes to the failure page and stores no state (sad path)', async () => {
    const harness = harnessFor();
    for (let n = 0; n < 20; n += 1) {
      const response = await start(harness, DEVICE, '203.0.113.20');
      expect(response.headers.location).toMatch(/^http:\/\/127\.0\.0\.1:/);
    }

    const refused = await start(harness, DEVICE, '203.0.113.20');
    const otherIp = await start(harness, DEVICE, '203.0.113.21');

    expect(refused.status).toBe(302);
    expect(refused.headers.location).toBe(failureUrl('en'));
    expect(parseSetCookies(refused).has(BINDING_COOKIE)).toBe(false);
    expect(otherIp.headers.location).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(await stateRows()).toHaveLength(21);
  });

  it('redirects to the failure page and stores no state when Google sign-in is not configured (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });

    const response = await start(harness);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(failureUrl('en'));
    expect(parseSetCookies(response).has(BINDING_COOKIE)).toBe(false);
    expect(await stateRows()).toEqual([]);
  });
});

describe('GET /auth/google/callback', () => {
  it('creates a verified, password-less user for a new gmail.com email and signs it in (AC-01, AC-04)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(harness, gmail('sub-ana', 'Ana@Gmail.com'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    expectBindingCleared(response);
    const [user, ...others] = await userRows();
    expect(others).toEqual([]);
    expect(user).toMatchObject({
      email: 'ana@gmail.com',
      password_hash: null,
      time_zone: 'America/Argentina/Cordoba',
      language: 'en',
    });
    expect(user?.email_verified_at).toBeInstanceOf(Date);
    expect(await identityRows()).toEqual([
      { user_id: user?.id, subject: 'sub-ana', email_authoritative: true },
    ]);
    expect(await outboxCount()).toBe(0);
    const session = await currentSession(harness.app, sessionFrom(response));
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      user: {
        id: user?.id,
        emailVerified: true,
        language: 'en',
        timeZone: 'America/Argentina/Cordoba',
      },
    });
    expect(await stateRows()).toEqual([]);
  });

  it('creates the account with the Google name as display name, shown by GET /profile (AC-05)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(
      harness,
      named(gmail('sub-ana', 'ana@gmail.com'), '  Ana Gómez  '),
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    expect(await displayNameOf('ana@gmail.com')).toBe('Ana Gómez');
    const profile = await profileOf(harness, response);
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      displayName: 'Ana Gómez',
      email: 'ana@gmail.com',
      deletionReauth: 'google',
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])(
    'creates the account with a null display name and signs in when the name claim is %s (AC-06)',
    async (_label, name) => {
      const harness = harnessFor();
      const identity = gmail('sub-ana', 'ana@gmail.com');

      const response = await googleSignIn(
        harness,
        name === undefined ? identity : named(identity, name),
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
      expect(await displayNameOf('ana@gmail.com')).toBeNull();
      expect((await profileOf(harness, response)).body).toMatchObject({
        displayName: null,
        deletionReauth: 'google',
      });
    },
  );

  it('stores the first 50 code points of a longer Google name (AC-07)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(
      harness,
      named(gmail('sub-ana', 'ana@gmail.com'), '😀'.repeat(60)),
    );

    expect(response.status).toBe(302);
    expect(await displayNameOf('ana@gmail.com')).toBe('😀'.repeat(50));
    expect((await profileOf(harness, response)).body).toMatchObject({
      displayName: '😀'.repeat(50),
    });
  });

  it('signs in with no display name when the name claim is not a string (FR-05)', async () => {
    const harness = harnessFor();
    const prepared = await prepare(harness, named(gmail('sub-ana', 'ana@gmail.com'), 'Ana'));
    google.setTokenOptions({ claimOverrides: { name: { first: 'Ana' } } });

    const response = await callback(harness, prepared.continueUrl, prepared.binding);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    expect(await displayNameOf('ana@gmail.com')).toBeNull();
  });

  it('still fails and creates nothing when a required claim is malformed next to a name (FR-05)', async () => {
    const harness = harnessFor();
    const prepared = await prepare(harness, named(gmail('sub-ana', 'ana@gmail.com'), 'Ana'));
    google.setTokenOptions({ claimOverrides: { email_verified: 'true' } });

    const response = await callback(harness, prepared.continueUrl, prepared.binding);

    expect(response.headers.location).toBe(failureUrl('en'));
    expect(await userRows()).toEqual([]);
  });

  it('creates the user with a non-authoritative identity for a verified email of another domain (AC-01, FR-07)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(harness, gmail('sub-bob', 'bob@example.com'));

    expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    const [user] = await userRows();
    expect(user).toMatchObject({ email: 'bob@example.com', password_hash: null });
    expect(await identityRows()).toEqual([
      { user_id: user?.id, subject: 'sub-bob', email_authoritative: false },
    ]);
    expect((await currentSession(harness.app, sessionFrom(response))).status).toBe(200);
  });

  it('marks a Workspace identity (hd claim) of another domain as authoritative (FR-07)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(harness, {
      sub: 'sub-wanda',
      email: 'wanda@corp.example',
      emailVerified: true,
      hd: 'corp.example',
    });

    expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    expect((await identityRows()).map((row) => row.email_authoritative)).toEqual([true]);
  });

  it('redirects to the failure page and creates nothing when the user cancels at Google (AC-02)', async () => {
    const harness = harnessFor();
    const { cancelUrl, binding } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));

    const response = await callback(harness, cancelUrl, binding);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(failureUrl('en'));
    expectNoSession(response);
    expectBindingCleared(response);
    expect(await userRows()).toEqual([]);
    expect(await identityRows()).toEqual([]);
  });

  it('signs an already linked subject in to the existing user, in its language (AC-03)', async () => {
    const harness = harnessFor();
    const identity = gmail('sub-ana', 'ana@gmail.com');
    const first = await googleSignIn(harness, identity);
    const [user] = await userRows();

    const second = await googleSignIn(harness, identity, { timeZone: 'UTC', language: 'es' });

    expect(second.status).toBe(302);
    expect(second.headers.location).toBe(`${LINK_BASE_URL}/en`);
    expect(await userRows()).toEqual([user]);
    const session = sessionFrom(second);
    expect(session.accessToken).not.toBe(sessionFrom(first).accessToken);
    expect((await currentSession(harness.app, session)).body).toMatchObject({
      user: { id: user?.id },
    });
  });

  it('creates nothing for an unverified Google email without an account (AC-05)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(harness, gmail('sub-ana', 'ana@gmail.com', false));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(failureUrl('en'));
    expectNoSession(response);
    expect(await userRows()).toEqual([]);
    expect(await identityRows()).toEqual([]);
  });

  it('links an authoritative verified email to the matching verified password account; the password still works (AC-06)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, { email: 'carla@gmail.com', password: PASSWORD });
    const before = await userRows();

    const response = await googleSignIn(harness, gmail('sub-carla', 'carla@gmail.com'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${LINK_BASE_URL}/es`);
    expect(await userRows()).toEqual(before);
    expect(await identityRows()).toEqual([
      { user_id: userId, subject: 'sub-carla', email_authoritative: true },
    ]);
    expect((await currentSession(harness.app, sessionFrom(response))).body).toMatchObject({
      user: { id: userId },
    });
    expect((await signIn(harness.app, 'carla@gmail.com', PASSWORD)).status).toBe(200);
  });

  it('keeps the display name of a verified account when Google is linked, and on a repeat sign-in (AC-08)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, { email: 'carla@gmail.com', password: PASSWORD });
    await setDisplayName(userId, 'Carla Mine');

    const linked = await googleSignIn(
      harness,
      named(gmail('sub-carla', 'carla@gmail.com'), 'Carla Google'),
    );
    expect(linked.status).toBe(302);
    expect(await displayNameOf('carla@gmail.com')).toBe('Carla Mine');

    const repeat = await googleSignIn(
      harness,
      named(gmail('sub-carla', 'carla@gmail.com'), 'Carla Renamed'),
    );
    expect(repeat.status).toBe(302);
    expect(await displayNameOf('carla@gmail.com')).toBe('Carla Mine');
    expect((await profileOf(harness, repeat)).body).toMatchObject({ displayName: 'Carla Mine' });
  });

  it.each([
    ['the Google name', 'Dan Google', 'Dan Google'],
    ['null when the claim is missing', undefined, null],
    ['null when the claim is empty', '', null],
    ['its first 50 code points when longer', '😀'.repeat(60), '😀'.repeat(50)],
  ])(
    'replaces the name typed at registration on a supersede with %s (AC-10)',
    async (_label, claim, expected) => {
      const harness = harnessFor();
      const userId = await seedUser(connection, {
        email: 'dan@gmail.com',
        password: PASSWORD,
        verified: false,
      });
      await setDisplayName(userId, 'Typed By Squatter');
      const identity = gmail('sub-dan', 'dan@gmail.com');

      const response = await googleSignIn(
        harness,
        claim === undefined ? identity : named(identity, claim),
      );

      expect(response.status).toBe(302);
      expect(await displayNameOf('dan@gmail.com')).toBe(expected);
      expect((await profileOf(harness, response)).body).toMatchObject({ displayName: expected });
    },
  );

  it('supersedes an unverified password account: password removed, sessions revoked, verified, linked (AC-07)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, {
      email: 'dan@gmail.com',
      password: PASSWORD,
      verified: false,
    });
    const squatter = sessionFrom(await signIn(harness.app, 'dan@gmail.com', PASSWORD));
    expect((await currentSession(harness.app, squatter)).status).toBe(200);

    const response = await googleSignIn(harness, gmail('sub-dan', 'dan@gmail.com'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${LINK_BASE_URL}/es`);
    const [user] = await userRows();
    expect(user).toMatchObject({ id: userId, password_hash: null, credentials_version: 1 });
    expect(user?.email_verified_at).toBeInstanceOf(Date);
    expect(await identityRows()).toEqual([
      { user_id: userId, subject: 'sub-dan', email_authoritative: true },
    ]);
    expect((await currentSession(harness.app, squatter)).status).toBe(401);
    expect((await currentSession(harness.app, sessionFrom(response))).body).toMatchObject({
      user: { id: userId, emailVerified: true },
    });
    const oldPassword = await signIn(harness.app, 'dan@gmail.com', PASSWORD);
    expect(oldPassword.status).toBe(401);
    expect(oldPassword.body).toEqual({ code: 'INVALID_CREDENTIALS' });
  });

  it('links nothing and leaves the account unchanged for an unverified email matching an account (AC-08)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: 'eve@gmail.com', password: PASSWORD });
    await seedUser(connection, { email: 'erin@gmail.com', password: PASSWORD, verified: false });
    const before = await userRows();

    const verified = await googleSignIn(harness, gmail('sub-eve', 'eve@gmail.com', false));
    const unverified = await googleSignIn(harness, gmail('sub-erin', 'erin@gmail.com', false));

    for (const response of [verified, unverified]) {
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(failureUrl('en'));
      expectNoSession(response);
    }
    expect(await userRows()).toEqual(before);
    expect(await identityRows()).toEqual([]);
  });

  it('links nothing and leaves the account unchanged for a non-authoritative email matching an account (AC-09)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: 'fay@example.com', password: PASSWORD });
    await seedUser(connection, { email: 'finn@example.com', password: PASSWORD, verified: false });
    const before = await userRows();

    const verified = await googleSignIn(harness, gmail('sub-fay', 'fay@example.com'));
    const unverified = await googleSignIn(harness, gmail('sub-finn', 'finn@example.com'));

    for (const response of [verified, unverified]) {
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(failureUrl('en'));
      expectNoSession(response);
    }
    expect(await userRows()).toEqual(before);
    expect(await identityRows()).toEqual([]);
    expect((await signIn(harness.app, 'finn@example.com', PASSWORD)).status).toBe(200);
  });

  it('refuses a Google account whose email belongs to a user already linked to another subject (sad path)', async () => {
    const harness = harnessFor();
    await googleSignIn(harness, gmail('sub-ivy', 'ivy@gmail.com'));
    const identities = await identityRows();

    const response = await googleSignIn(harness, gmail('sub-ivy-2', 'ivy@gmail.com'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(failureUrl('en'));
    expectNoSession(response);
    expect(await identityRows()).toEqual(identities);
    expect(await userRows()).toHaveLength(1);
    const reasons = harness.lines
      .map((line) => JSON.parse(line) as { msg?: string; reason?: string })
      .filter((entry) => entry.msg === 'google sign-in failed')
      .map((entry) => entry.reason);
    expect(reasons).toEqual(['another_identity_linked']);
  });

  it('answers 500 INTERNAL and still clears the binding cookie when the callback hits an unexpected fault', async () => {
    // Nothing listens on port 1: every query fails as a database outage would.
    const unreachable = createDatabase('postgres://argent:argent@127.0.0.1:1/argent_test');
    try {
      const harness = createIdentityHarness(unreachable, { realSessions: true, google });

      const response = await request(harness.app)
        .get('/auth/google/callback?state=some-state&code=some-code')
        .set('Cookie', `${BINDING_COOKIE}=some-binding`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL' });
      expectBindingCleared(response);
      expectNoSession(response);
    } finally {
      await unreachable.pool.end();
    }
  });

  describe('state and binding (sad paths)', () => {
    it('fails without the binding cookie', async () => {
      const harness = harnessFor();
      const { continueUrl } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));

      const response = await callback(harness, continueUrl);

      expect(response.headers.location).toBe(failureUrl('es'));
      expectNoSession(response);
      expect(await userRows()).toEqual([]);
    });

    it("fails with another browser's binding", async () => {
      const harness = harnessFor();
      const mine = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));
      const theirs = await prepare(harness, gmail('sub-mallory', 'mallory@gmail.com'));

      const response = await callback(harness, theirs.continueUrl, mine.binding);

      expect(response.headers.location).toBe(failureUrl('es'));
      expectNoSession(response);
      expect(await userRows()).toEqual([]);
      // The victim's own flow still completes: a foreign binding does not burn the state.
      const own = await callback(harness, mine.continueUrl, mine.binding);
      expect(own.headers.location).toBe(`${LINK_BASE_URL}/en`);
    });

    it('fails with a reused state', async () => {
      const harness = harnessFor();
      const { continueUrl, binding } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));
      expect((await callback(harness, continueUrl, binding)).headers.location).toBe(
        `${LINK_BASE_URL}/en`,
      );
      const tokenRequests = google.tokenRequests;

      const replay = await callback(harness, continueUrl, binding);

      expect(replay.headers.location).toBe(failureUrl('es'));
      expectNoSession(replay);
      expect(google.tokenRequests).toBe(tokenRequests);
    });

    it('fails with a state older than 10 minutes', async () => {
      const harness = harnessFor();
      const { continueUrl, binding } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));
      const tokenRequests = google.tokenRequests;
      harness.clock.advance(TEN_MINUTES + 1000);

      const response = await callback(harness, continueUrl, binding);

      expect(response.headers.location).toBe(failureUrl('es'));
      expectNoSession(response);
      expect(google.tokenRequests).toBe(tokenRequests);
      expect(await userRows()).toEqual([]);
    });

    it('fails with a repeated code parameter', async () => {
      const harness = harnessFor();
      const { continueUrl, binding } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));
      const tokenRequests = google.tokenRequests;

      const response = await callback(harness, `${continueUrl}&code=4%2Fother`, binding);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(failureUrl('es'));
      expectNoSession(response);
      expect(google.tokenRequests).toBe(tokenRequests);
      expect(await userRows()).toEqual([]);
    });

    it('treats an empty state= as missing and an empty hd= as absent (redirect, not 400)', async () => {
      const harness = harnessFor();
      const { continueUrl, binding } = await prepare(harness, gmail('sub-ana', 'ana@gmail.com'));
      const emptyState = new URL(continueUrl);
      emptyState.searchParams.set('state', '');

      const noState = await callback(harness, emptyState.href, binding);
      const emptyHd = await callback(harness, `${continueUrl}&hd=`, binding);

      expect(noState.status).toBe(302);
      expect(noState.headers.location).toBe(failureUrl('es'));
      expect(emptyHd.status).toBe(302);
      expect(emptyHd.headers.location).toBe(`${LINK_BASE_URL}/en`);
    });

    it('answers 400 VALIDATION_FAILED only for a value over 2048 characters or over 5 repeats', async () => {
      const harness = harnessFor();

      const long = await request(harness.app).get(
        `/auth/google/callback?state=s&code=${'c'.repeat(2049)}`,
      );
      const repeated = await request(harness.app).get(
        `/auth/google/callback?state=s&${Array.from({ length: 6 }, () => 'scope=x').join('&')}`,
      );

      expect(long.status).toBe(400);
      expect(long.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['query.code'] });
      expect(repeated.status).toBe(400);
      expect(repeated.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['query.scope'] });
    });
  });

  it('fails and creates nothing when the ID token does not verify (NFR-02)', async () => {
    const harness = harnessFor();
    google.setTokenOptions({ audience: 'someone-else.apps.googleusercontent.com' });

    const response = await googleSignIn(harness, gmail('sub-ana', 'ana@gmail.com'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(failureUrl('en'));
    expectNoSession(response);
    expect(await userRows()).toEqual([]);
    expect(await identityRows()).toEqual([]);
  });

  it('writes no code, ID token, state, binding, verifier or email to the logs', async () => {
    const harness = harnessFor();
    const identity = named(gmail('sub-log', 'logged.person@gmail.com'), 'Zelda Quuxington');
    const prepared = await prepare(harness, identity);
    const [row] = await stateRows();
    const approve = new URL(prepared.continueUrl);
    const secrets = [
      approve.searchParams.get('code') ?? 'missing-code',
      approve.searchParams.get('state') ?? 'missing-state',
      prepared.binding,
      String(row?.code_verifier),
      'logged.person',
      'Zelda',
    ];

    expect((await callback(harness, prepared.continueUrl, prepared.binding)).status).toBe(302);
    google.setTokenOptions({ audience: 'someone-else' });
    const failed = await prepare(harness, identity);
    secrets.push(new URL(failed.continueUrl).searchParams.get('code') ?? '', failed.binding);
    expect((await callback(harness, failed.continueUrl, failed.binding)).headers.location).toBe(
      failureUrl('en'),
    );

    const logs = harness.lines.join('\n');
    expect(logs).toContain('google sign-in');
    for (const secret of secrets) expect(logs).not.toContain(secret);
    // No JWT (ID token or access token) in any line.
    expect(logs).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
  });
});
