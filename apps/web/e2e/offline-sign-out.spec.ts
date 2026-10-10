import { expect, test, type Page, type Route } from '@playwright/test';
import { signIn } from './support/accounts';
import { movementRowIds, resetAttemptLimits } from './support/database';
import {
  ACCOUNT_OPTION,
  CATEGORY,
  es,
  prepareOnlineVisit,
  requireProductionBuild,
  t,
} from './support/offline-visit';
import { queuedIds } from './support/queue';
import { chooseMovementType } from './support/movement-type';

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
// Each flow registers a user, builds a copy of its data on the device and works with a real worker.
test.describe.configure({ timeout: 120_000 });

test.beforeAll(() => {
  requireProductionBuild();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

const copy = es.auth.signOut;
const signOutButton = (page: Page) => page.getByRole('button', { name: copy.label });
const confirmation = (page: Page) => page.getByRole('alertdialog', { name: copy.confirmTitle });

/** The singular branch of the ICU plural in the catalog, for a count of one. */
function oneChangeLost(message: string): string {
  const branch = /one \{([^}]*)\}/.exec(message)?.[1];
  if (branch === undefined) throw new Error('The confirmation body has no singular branch');
  return branch.replace('#', '1');
}

/** The user id in the session pointer the app wrote, or `null` when there is none. */
async function pointerUserId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pointer = JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as {
      userId: string;
    } | null;
    return pointer?.userId ?? null;
  });
}

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ''),
  );
}

/** Saves one expense with the browser offline; it waits in the queue. Answers the user id. */
async function queueOneExpense(page: Page): Promise<string> {
  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await chooseMovementType(page, t.fields.type, t.types.expense);
  await page.getByLabel(t.fields.category, { exact: true }).selectOption({ label: CATEGORY });
  await page.getByLabel(t.fields.amount, { exact: true }).fill('25,00');
  await page.getByLabel(t.fields.rate, { exact: true }).fill('1250,50');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect.poll(() => queuedIds(page)).toHaveLength(1);
  const userId = await pointerUserId(page);
  if (userId === null) throw new Error('The app has not written the session pointer');
  return userId;
}

test('confirming a sign out with a pending change removes the database and the pointer; cancel keeps the user in (AC-03, AC-04)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sign-out-pending', [], 1);
  await context.setOffline(true);
  const userId = await queueOneExpense(page);

  // The sync pass sends the movement as soon as the browser is back online; holding the request
  // keeps the change pending on the device.
  const held: Route[] = [];
  await page.route(
    (url) => url.pathname === '/movements',
    async (route) => {
      if (route.request().method() === 'POST') held.push(route);
      else await route.fallback();
    },
  );
  await context.setOffline(false);
  await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThan(0);

  await signOutButton(page).click();
  await expect(confirmation(page)).toContainText(oneChangeLost(copy.confirmBody));
  await confirmation(page).getByRole('button', { name: copy.cancel }).click();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/es\/movements\/new$/);
  expect(await pointerUserId(page)).toBe(userId);
  expect(await queuedIds(page)).toHaveLength(1);

  await signOutButton(page).click();
  await confirmation(page).getByRole('button', { name: copy.confirm }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  await expect.poll(() => databaseNames(page)).not.toContain(`pesly-${userId}`);
  expect(await page.evaluate(() => localStorage.getItem('pesly.session'))).toBeNull();
});

test('a sign out with nothing pending goes straight through and wipes the device (AC-04)', async ({
  page,
}) => {
  await prepareOnlineVisit(page, 'sign-out-empty', [], 1);
  const userId = await pointerUserId(page);
  if (userId === null) throw new Error('The app has not written the session pointer');
  await expect.poll(() => databaseNames(page)).toContain(`pesly-${userId}`);

  // Reaching sign-in after one click, with no confirm click, shows no confirmation was asked for.
  await signOutButton(page).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  await expect.poll(() => databaseNames(page)).not.toContain(`pesly-${userId}`);
  expect(await page.evaluate(() => localStorage.getItem('pesly.session'))).toBeNull();
});

test('a session that expires with a queued change keeps it, and the same user signing in again gets it synced (AC-01)', async ({
  page,
  context,
}) => {
  const email = await prepareOnlineVisit(page, 'sign-out-expiry', [], 1);
  await context.setOffline(true);
  const userId = await queueOneExpense(page);
  const [queued] = await queuedIds(page);
  if (queued === undefined) throw new Error('Nothing was queued');

  // The session ends while the change waits. Back online the shell's session check answers 401 and
  // sends the user to sign in before any pass starts, so nothing is sent and nothing is wiped.
  await context.clearCookies();
  await context.setOffline(false);

  await page.goto('/es/movements');
  await expect(page).toHaveURL(/\/es\/sign-in$/, { timeout: 15_000 });
  expect(await pointerUserId(page)).toBe(userId);
  expect(await queuedIds(page)).toEqual([queued]);
  expect(await movementRowIds(email)).not.toContain(queued);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await expect.poll(() => movementRowIds(email), { timeout: 30_000 }).toContain(queued);
  await expect.poll(() => queuedIds(page), { timeout: 15_000 }).toEqual([]);
});

test('a sign out attempted offline shows the error and keeps the queued change', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sign-out-offline', [], 1);
  await context.setOffline(true);
  const userId = await queueOneExpense(page);

  await signOutButton(page).click();
  await expect(confirmation(page)).toContainText(oneChangeLost(copy.confirmBody));
  await confirmation(page).getByRole('button', { name: copy.confirm }).click();

  await expect(page.getByRole('alert').filter({ hasText: es.errors.network })).toBeVisible();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/es\/movements\/new$/);
  expect(await pointerUserId(page)).toBe(userId);
  expect(await queuedIds(page)).toHaveLength(1);
  expect(await databaseNames(page)).toContain(`pesly-${userId}`);
});
