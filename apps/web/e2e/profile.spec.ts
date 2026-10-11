import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';

const es = catalogs.es;
const en = catalogs.en;

// The name every freshly registered user typed on the registration form.
const SIGN_UP_NAME = 'Ana Pérez';

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('a verified user edits the name and preferences, signs out and in, and sees them saved (AC-02, AC-05, AC-06, AC-07)', async ({
  page,
}) => {
  const email = uniqueEmail('profile');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);

  await page.getByRole('link', { name: es.app.nav.settings }).click();
  await expect(page).toHaveURL(/\/es\/settings\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: es.profile.title })).toBeVisible();
  await expect(page.getByRole('link', { name: es.app.nav.settings })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const name = page.getByLabel(es.profile.account.displayName, { exact: true });
  await expect(name).toHaveValue(SIGN_UP_NAME);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(es.profile.account.twoFactorOff)).toBeVisible();

  await name.fill('Ana María');
  await page.getByRole('button', { name: es.profile.account.submit }).click();
  await expect(page.getByText(es.profile.saved)).toHaveCount(1);

  await page.getByLabel(es.profile.preferences.defaultRateType).selectOption('mep');
  await page.getByLabel(es.profile.preferences.displayCurrency).selectOption('USD');
  await page.getByLabel(es.profile.preferences.timeZone).selectOption('Europe/Madrid');
  await page.getByRole('button', { name: es.profile.preferences.submit }).click();
  await expect(page.getByText(es.profile.saved)).toHaveCount(2);

  await page.getByRole('button', { name: es.auth.signOut.label }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await page.goto('/es/settings/profile');

  await expect(name).toHaveValue('Ana María');
  await expect(page.getByLabel(es.profile.preferences.defaultRateType)).toHaveValue('mep');
  await expect(page.getByLabel(es.profile.preferences.displayCurrency)).toHaveValue('USD');
  await expect(page.getByLabel(es.profile.preferences.timeZone)).toHaveValue('Europe/Madrid');
});

test('a visitor registers with a display name, verifies, signs in and sees the name on the profile screen (AC-03)', async ({
  page,
}) => {
  const email = uniqueEmail('profile-signup-name');
  await registerAndVerify(page, email, 'Lucía Gómez');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);

  await page.getByRole('link', { name: es.app.nav.settings }).click();

  await expect(page).toHaveURL(/\/es\/settings\/profile$/);
  await expect(page.getByLabel(es.profile.account.displayName, { exact: true })).toHaveValue(
    'Lucía Gómez',
  );
});

test('an empty name is refused on the client with a field message (AC-03)', async ({ page }) => {
  const email = uniqueEmail('profile-empty');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await page.goto('/es/settings/profile');

  await page.getByLabel(es.profile.account.displayName, { exact: true }).fill('   ');
  await page.getByRole('button', { name: es.profile.account.submit }).click();

  await expect(page.getByText(es.profile.errors.displayNameRequired)).toBeVisible();
  await expect(page.getByLabel(es.profile.account.displayName, { exact: true })).toBeFocused();
});

test('switching the language to English shows the profile in English and back shows Spanish (AC-09)', async ({
  page,
}) => {
  const email = uniqueEmail('profile-language');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await page.goto('/es/settings/profile');
  await expect(page.getByRole('heading', { level: 1, name: es.profile.title })).toBeVisible();

  await page.getByLabel(es.profile.preferences.language).selectOption('en');
  await page.getByRole('button', { name: es.profile.preferences.submit }).click();

  await expect(page).toHaveURL(/\/en\/settings\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: en.profile.title })).toBeVisible();
  await expect(page.getByLabel(en.profile.account.displayName, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: en.app.nav.settings })).toBeVisible();
  await expect(page.getByText(es.profile.account.title)).toHaveCount(0);

  await page.getByLabel(en.profile.preferences.language).selectOption('es');
  await page.getByRole('button', { name: en.profile.preferences.submit }).click();

  await expect(page).toHaveURL(/\/es\/settings\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: es.profile.title })).toBeVisible();
  await expect(page.getByText(en.profile.account.title)).toHaveCount(0);
});
