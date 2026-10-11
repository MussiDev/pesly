import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { accountRecord, resetAttemptLimits } from './support/database';
import {
  reachGoogleReauthentication,
  signInWithGoogle,
  uniqueSubject,
} from './support/fake-google';
import { TestAuthenticator, wrongCode } from './support/totp';

const es = catalogs.es;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
// A TOTP code is accepted once per 30-second step, so a flow may wait for the next step.
test.describe.configure({ timeout: 120_000 });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

/** From the signed-in home: profile, then the link of the danger card. */
async function openDeleteAccount(page: Page): Promise<void> {
  await page.getByRole('link', { name: es.app.nav.settings }).click();
  await expect(page).toHaveURL(/\/es\/settings\/profile$/);
  await page.getByRole('link', { name: es.profile.deleteAccount.link }).click();
  await expect(page).toHaveURL(/\/es\/settings\/delete-account$/);
  await expect(page.getByRole('heading', { level: 1, name: es.deleteUser.title })).toBeVisible();
}

/** Turns 2FA on from the security settings and returns the test authenticator for its secret. */
async function enableTwoFactor(page: Page): Promise<TestAuthenticator> {
  await page.getByRole('link', { name: es.app.nav.security }).click();
  await expect(page).toHaveURL(/\/es\/settings\/security$/);
  await page.getByRole('button', { name: es.security.twoFactor.enable }).click();
  const setup = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: es.security.setup.title }) });
  const secret = (await setup.locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const authenticator = new TestAuthenticator(secret);

  await page.getByLabel(es.security.setup.code).fill(await authenticator.nextCode());
  await page.getByRole('button', { name: es.security.setup.submit }).click();
  await page.getByRole('button', { name: es.security.recoveryCodes.done }).click();
  await expect(page.getByText(es.security.twoFactor.on)).toBeVisible();
  return authenticator;
}

test('a user with a password keeps the account with a wrong password and deletes it with the right one (AC-01, AC-02)', async ({
  page,
}) => {
  const email = uniqueEmail('delete');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await openDeleteAccount(page);

  // A user with a password never sees the Google step (AC-10).
  await expect(page.getByRole('button', { name: es.deleteUser.google.continue })).toHaveCount(0);

  await page.getByLabel(es.deleteUser.password).fill('not the right password');
  await page.getByRole('button', { name: es.deleteUser.submit }).click();
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/settings\/delete-account$/);
  await expect(page.getByLabel(es.deleteUser.password)).toHaveValue('');
  expect((await accountRecord(email)).users).toBe(1);

  await page.getByLabel(es.deleteUser.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.deleteUser.submit }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  expect((await accountRecord(email)).users).toBe(0);

  await signIn(page, email);
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('a user with 2FA needs the code: a wrong one keeps the account and a valid one deletes it (AC-03, AC-04)', async ({
  page,
}) => {
  const email = uniqueEmail('delete-2fa');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  const authenticator = await enableTwoFactor(page);
  await openDeleteAccount(page);
  await expect(page.getByLabel(es.deleteUser.code)).toBeVisible();

  await page.getByLabel(es.deleteUser.password).fill(PASSWORD);
  await page.getByLabel(es.deleteUser.code).fill(wrongCode(authenticator.secret));
  await page.getByRole('button', { name: es.deleteUser.submit }).click();
  await expect(page.getByText(es.errors.codeInvalid)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/settings\/delete-account$/);
  expect((await accountRecord(email)).users).toBe(1);

  await page.getByLabel(es.deleteUser.password).fill(PASSWORD);
  await page.getByLabel(es.deleteUser.code).fill(await authenticator.nextCode());
  await page.getByRole('button', { name: es.deleteUser.submit }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  expect((await accountRecord(email)).users).toBe(0);
});

test('a Google-created user re-authenticates with Google, confirms and is deleted (AC-06, AC-08)', async ({
  page,
}) => {
  const identity = {
    sub: uniqueSubject('delete'),
    email: uniqueEmail('delete-google'),
    emailVerified: true,
  };
  await signInWithGoogle(page, identity);
  await expect(page).toHaveURL(/\/es$/);
  expect(await accountRecord(identity.email)).toMatchObject({
    users: 1,
    googleIdentities: 1,
    hasPassword: false,
  });
  await openDeleteAccount(page);
  await expect(page.getByLabel(es.deleteUser.password)).toHaveCount(0);

  const authorizationRequest = await reachGoogleReauthentication(page, identity);
  // The fake Google server was asked to make the user sign in again.
  expect(authorizationRequest).toMatchObject({ prompt: 'login', max_age: '0' });

  await page.locator('#continue').click();
  await expect(page).toHaveURL(/\/es\/settings\/delete-account\?reauth=ready$/);
  await expect(page.getByText(es.deleteUser.google.confirmed)).toBeVisible();
  await expect(page.getByLabel(es.deleteUser.password)).toHaveCount(0);
  expect((await accountRecord(identity.email)).users).toBe(1);

  await page.getByRole('button', { name: es.deleteUser.submit }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  expect((await accountRecord(identity.email)).users).toBe(0);
});
