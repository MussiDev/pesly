import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { accountRecord, resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';
import {
  FAKE_GOOGLE_ORIGIN,
  reachGoogleConsent,
  signInWithGoogle,
  uniqueSubject,
  type FakeGoogleIdentity,
} from './support/fake-google';

const API_URL = 'http://localhost:4000';
const PASSWORD = 'correct horse battery staple';
const BINDING_COOKIE = '__Secure-argent_oauth';

const es = catalogs.es;

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string, domain = 'gmail.com'): string {
  return `argent.e2e.${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@${domain}`;
}

function googleUser(
  label: string,
  {
    email = uniqueEmail(label),
    emailVerified = true,
    name,
  }: { email?: string; emailVerified?: boolean; name?: string } = {},
): FakeGoogleIdentity {
  return {
    sub: uniqueSubject(label),
    email,
    emailVerified,
    ...(name === undefined ? {} : { name }),
  };
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.displayName).fill('Ana Pérez');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
}

async function registerAndVerify(page: Page, email: string): Promise<void> {
  await register(page, email);
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
}

async function signInWithPassword(page: Page, email: string): Promise<void> {
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
}

async function expectSignedIn(page: Page, locale: 'es' | 'en' = 'es'): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  await expect(
    page.getByRole('button', { name: catalogs[locale].auth.signOut.label }),
  ).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: es.auth.signOut.label }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
}

async function sessionUser(page: Page): Promise<Record<string, unknown>> {
  const response = await page.request.get(`${API_URL}/auth/session`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { user: Record<string, unknown> }).user;
}

/** Back on sign-in with the Google error, and the `?error=` parameter gone from the URL. */
async function expectGoogleError(page: Page): Promise<void> {
  await expect(page.getByText(es.errors.googleFailed)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
}

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('a new Google user with a verified gmail.com email lands signed in, then signs out (AC-01, AC-04)', async ({
  page,
}) => {
  const identity = googleUser('new');

  await signInWithGoogle(page, identity);

  await expectSignedIn(page);
  expect(await sessionUser(page)).toMatchObject({
    email: identity.email,
    emailVerified: true,
    language: 'es',
    timeZone: expect.stringMatching(/Cordoba/),
  });
  expect(await accountRecord(identity.email)).toEqual({
    users: 1,
    googleIdentities: 1,
    hasPassword: false,
    emailVerified: true,
    verificationEmails: 0,
  });

  await signOut(page);
  await page.goto('/es');
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('a Google sign-up shows the name from the Google profile on the profile screen (AC-05)', async ({
  page,
}) => {
  const identity = googleUser('named', { name: 'Lucía Gómez' });

  await signInWithGoogle(page, identity);

  await expectSignedIn(page);
  await page.getByRole('link', { name: es.app.nav.settings }).click();
  await expect(page).toHaveURL(/\/es\/settings\/profile$/);
  await expect(page.getByLabel(es.profile.account.displayName, { exact: true })).toHaveValue(
    'Lucía Gómez',
  );
});

test('cancelling on the Google screen returns to sign-in with the Google error (AC-02)', async ({
  page,
}) => {
  const identity = googleUser('cancel');

  await signInWithGoogle(page, identity, { choice: 'cancel' });

  await expectGoogleError(page);
  expect((await accountRecord(identity.email)).users).toBe(0);

  // A reload does not show the error again.
  await page.reload();
  await expect(page.getByRole('heading', { name: es.auth.signIn.title })).toBeVisible();
  await expect(page.getByText(es.errors.googleFailed)).toHaveCount(0);
});

test('the callback navigation starts on the fake Google site and carries the Lax binding cookie', async ({
  page,
  context,
}) => {
  const identity = googleUser('cross-site');
  await reachGoogleConsent(page, identity);

  // The consent page is on 127.0.0.1, another site than the API on localhost.
  expect(new URL(page.url()).origin).toBe(FAKE_GOOGLE_ORIGIN);
  const binding = (await context.cookies(`${API_URL}/auth/google/callback`)).find(
    (cookie) => cookie.name === BINDING_COOKIE,
  );
  expect(binding).toMatchObject({
    sameSite: 'Lax',
    httpOnly: true,
    secure: true,
    path: '/auth/google',
  });

  const callback = page.waitForRequest((request) =>
    request.url().startsWith(`${API_URL}/auth/google/callback`),
  );
  await page.locator('#continue').click();
  const headers = await (await callback).allHeaders();

  expect(headers['sec-fetch-site']).toBe('cross-site');
  expect(headers.cookie ?? '').toContain(`${BINDING_COOKIE}=`);
  await expectSignedIn(page);
  // Single use: the binding cookie is gone once the callback is handled.
  expect(
    (await context.cookies(`${API_URL}/auth/google/callback`)).map((cookie) => cookie.name),
  ).not.toContain(BINDING_COOKIE);
});

test('the same Google user signing in again reaches the same account (AC-03)', async ({ page }) => {
  const identity = googleUser('again');
  await signInWithGoogle(page, identity);
  await expectSignedIn(page);
  const first = await sessionUser(page);
  await signOut(page);

  await signInWithGoogle(page, identity);

  await expectSignedIn(page);
  expect((await sessionUser(page)).id).toBe(first.id);
  expect(await accountRecord(identity.email)).toMatchObject({ users: 1, googleIdentities: 1 });
});

test('a Google user with an unverified email sees the Google error and no account is created (AC-05)', async ({
  page,
}) => {
  const identity = googleUser('unverified-new', { emailVerified: false });

  await signInWithGoogle(page, identity);

  await expectGoogleError(page);
  expect((await accountRecord(identity.email)).users).toBe(0);
});

test('a verified password account signing in with Google keeps one account and its password (AC-06)', async ({
  page,
}) => {
  const email = uniqueEmail('link');
  await registerAndVerify(page, email);
  await signInWithPassword(page, email);
  await expectSignedIn(page);
  const passwordUser = await sessionUser(page);
  await signOut(page);

  await signInWithGoogle(page, googleUser('link', { email }));

  await expectSignedIn(page);
  expect((await sessionUser(page)).id).toBe(passwordUser.id);
  expect(await accountRecord(email)).toMatchObject({
    users: 1,
    googleIdentities: 1,
    hasPassword: true,
  });
  await signOut(page);
  await signInWithPassword(page, email);
  await expectSignedIn(page);
  expect((await sessionUser(page)).id).toBe(passwordUser.id);
});

test('an unverified password account is taken over by the verified gmail.com owner; the old password stops working (AC-07)', async ({
  page,
}) => {
  const email = uniqueEmail('supersede');
  await register(page, email);

  await signInWithGoogle(page, googleUser('supersede', { email }));

  await expectSignedIn(page);
  expect(await sessionUser(page)).toMatchObject({ email, emailVerified: true });
  expect(await accountRecord(email)).toMatchObject({
    users: 1,
    googleIdentities: 1,
    hasPassword: false,
    emailVerified: true,
  });
  await signOut(page);
  await signInWithPassword(page, email);
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('an unverified Google email matching an existing account shows the Google error (AC-08)', async ({
  page,
}) => {
  const email = uniqueEmail('unverified-existing');
  await registerAndVerify(page, email);

  await signInWithGoogle(page, googleUser('unverified-existing', { email, emailVerified: false }));

  await expectGoogleError(page);
  expect(await accountRecord(email)).toMatchObject({
    users: 1,
    googleIdentities: 0,
    hasPassword: true,
    emailVerified: true,
  });
});

test('a verified but non-authoritative Google email matching an existing account shows the Google error (AC-09)', async ({
  page,
}) => {
  const email = uniqueEmail('not-authoritative', 'e2e.argent.test');
  await register(page, email);

  await signInWithGoogle(page, googleUser('not-authoritative', { email }));

  await expectGoogleError(page);
  // Left unchanged: still unverified, still with its password, not linked.
  expect(await accountRecord(email)).toMatchObject({
    users: 1,
    googleIdentities: 0,
    hasPassword: true,
    emailVerified: false,
  });
});

test.describe('in an English browser', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

  test('Google registration from /en/register opens the app in English (FR-01)', async ({
    page,
  }) => {
    const identity = googleUser('english');

    await signInWithGoogle(page, identity, { path: '/en/register', locale: 'en' });

    await expectSignedIn(page, 'en');
    expect(await sessionUser(page)).toMatchObject({
      email: identity.email,
      language: 'en',
      timeZone: expect.stringMatching(/New_York/),
    });
  });
});

for (const locale of ['es', 'en'] as const) {
  for (const path of ['sign-in', 'register'] as const) {
    test(`/${locale}/${path} offers Google sign-in`, async ({ page }) => {
      await page.goto(`/${locale}/${path}`);

      const link = page.getByRole('link', { name: catalogs[locale].auth.google.continue });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        `${API_URL}/auth/google/start?timeZone=America%2FCordoba&language=${locale}`,
      );
      await expect(page.getByText(catalogs[locale].auth.or, { exact: true })).toBeVisible();
    });
  }
}
