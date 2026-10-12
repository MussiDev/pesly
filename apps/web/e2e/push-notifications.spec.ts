import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import {
  ALLOWED_ENDPOINT,
  DISALLOWED_ENDPOINT,
  browserHasSubscription,
  fakeSubscription,
  installFakePush,
  permissionAsks,
  storedEndpoints,
} from './support/push';

const es = catalogs.es;
const t = es.notifications;

test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('enabling stores one subscription, reopening the screen shows it on and re-registers it, disabling removes it (AC-47, AC-48, AC-51, AC-57)', async ({
  page,
}) => {
  await installFakePush(page, fakeSubscription(ALLOWED_ENDPOINT));
  const email = uniqueEmail('push');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);

  await page.goto('/es/settings/notifications');
  await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByText(t.status.off)).toBeVisible();
  // Signing in and opening the screen never asked for the permission.
  expect(await permissionAsks(page)).toBe(0);
  expect(await storedEndpoints(email)).toEqual([]);

  await page.getByRole('button', { name: t.actions.enable }).click();
  await expect(page.getByText(t.status.on)).toBeVisible();
  expect(await permissionAsks(page)).toBe(1);
  expect(await storedEndpoints(email)).toEqual([ALLOWED_ENDPOINT]);

  const registered = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/push/subscriptions'),
  );
  await page.reload();
  await registered;
  await expect(page.getByText(t.status.on)).toBeVisible();
  expect(await permissionAsks(page)).toBe(1);
  expect(await storedEndpoints(email)).toEqual([ALLOWED_ENDPOINT]);

  await page.getByRole('button', { name: t.actions.disable }).click();
  await expect(page.getByText(t.status.off)).toBeVisible();
  await expect(page.getByRole('button', { name: t.actions.enable })).toBeVisible();
  expect(await storedEndpoints(email)).toEqual([]);
  expect(await browserHasSubscription(page)).toBe(false);
});

test('a subscription from an unknown push service ends in an error state and stores nothing (AC-50)', async ({
  page,
}) => {
  await installFakePush(page, fakeSubscription(DISALLOWED_ENDPOINT));
  const email = uniqueEmail('push-rejected');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await page.goto('/es/settings/notifications');

  await page.getByRole('button', { name: t.actions.enable }).click();

  await expect(page.getByText(t.errors.enable)).toBeVisible();
  await expect(page.getByText(t.status.off)).toBeVisible();
  await expect(page.getByRole('button', { name: es.app.retry })).toBeVisible();
  expect(await storedEndpoints(email)).toEqual([]);
  expect(await browserHasSubscription(page)).toBe(false);
});
