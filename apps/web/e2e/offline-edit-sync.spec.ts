import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/accounts';
import { archiveAccount, movementAmount, resetAttemptLimits } from './support/database';
import {
  ACCOUNT_NAME,
  es,
  prepareOnlineVisit,
  requireProductionBuild,
  t,
  trackSameOriginFailures,
} from './support/offline-visit';

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
// Each flow registers a user, builds a copy of its data on the device and works with a real worker.
test.describe.configure({ timeout: 180_000 });

test.beforeAll(() => {
  requireProductionBuild();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

const rows = (page: Page) => page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME });
const waiting = (page: Page) =>
  page.getByRole('status').filter({ hasText: /esperando sincronizarse/ });
const editLinks = (page: Page) =>
  page.getByRole('link', { name: new RegExp(`^${t.list.actions.edit} `) });

/** The id in the edit link of the row at `index`: rows carry no id of their own. */
async function idOfRow(page: Page, index: number): Promise<string> {
  const href = await editLinks(page).nth(index).getAttribute('href');
  const id = new URL(href ?? '', 'http://localhost').searchParams.get('id');
  if (id === null) throw new Error(`Row ${index} has no edit link`);
  return id;
}

/** The edit screen is warmed after sign-in; waits until the worker has it for offline use. */
async function waitForCachedEditScreen(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cache = await caches.open('pesly-pages-v1');
          const keys = await cache.keys();
          return keys.some((key) => new URL(key.url).pathname === '/es/movements/edit');
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function editAmount(page: Page, id: string, amount: string, account?: string): Promise<void> {
  await page.goto(`/es/movements/edit?id=${id}`);
  const field = page.getByLabel(t.fields.amount, { exact: true });
  await field.fill(amount);
  if (account !== undefined) {
    await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: account });
  }
  await page.getByRole('button', { name: t.form.save }).click();
  await expect(page).toHaveURL(/\/es\/movements$/);
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  return errors;
}

test('offline, a user edits one movement and deletes another; both sync with no click when the connection returns (AC-01, AC-02, AC-03, AC-07)', async ({
  page,
  context,
}) => {
  const consoleErrors = trackConsoleErrors(page);
  const sameOriginFailures = trackSameOriginFailures(page);
  await prepareOnlineVisit(page, 'sync-edit-delete');
  await waitForCachedEditScreen(page);
  await page.goto('/es/movements');
  const edited = await idOfRow(page, 0);
  const deleted = await idOfRow(page, 1);
  await context.setOffline(true);

  await editAmount(page, edited, '77,00');
  await expect(rows(page).first()).toContainText(t.list.pending);
  await rows(page)
    .nth(1)
    .getByRole('button', { name: new RegExp(`^${t.list.actions.delete} `) })
    .click();
  await page.getByRole('button', { name: t.list.actions.confirmDeleteYes }).click();
  await expect(page.locator(`a[href$="id=${deleted}"]`)).toHaveCount(0);
  await expect(waiting(page)).toHaveText('2 cambios esperando sincronizarse');

  await context.setOffline(false);

  await expect(waiting(page)).toHaveCount(0, { timeout: 30_000 });
  expect(await movementAmount(edited)).toBe('7700');
  expect(await movementAmount(deleted)).toBeNull();
  await page.reload();
  await expect(rows(page).first().getByRole('img', { name: t.list.synced })).toBeVisible();
  await expect(page.getByText(t.list.pending, { exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  expect(sameOriginFailures).toEqual([]);
});

test('two devices edit the same movement: the database keeps the one sent last and both lists show it (AC-04)', async ({
  page,
  context,
  browser,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-conflict');
  await waitForCachedEditScreen(page);
  await page.goto('/es/movements');
  const id = await idOfRow(page, 0);
  const other = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const otherPage = await other.newPage();
  await signIn(otherPage, email);

  await context.setOffline(true);
  await editAmount(page, id, '11,00');
  await editAmount(otherPage, id, '22,00');
  expect(await movementAmount(id)).toBe('2200');
  await context.setOffline(false);

  await expect.poll(() => movementAmount(id), { timeout: 30_000 }).toBe('1100');
  await page.goto('/es/movements');
  await otherPage.goto('/es/movements');
  for (const view of [page, otherPage]) {
    await expect(view.locator(`li:has(a[href$="id=${id}"])`)).toContainText('11,00');
  }
  await other.close();
});

test('an edit queued against an account archived meanwhile shows as failed with the reason, and discard removes it (AC-05)', async ({
  page,
  context,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-failed', [{ name: 'Banco', currency: 'ARS' }]);
  await waitForCachedEditScreen(page);
  await page.goto('/es/movements');
  const id = await idOfRow(page, 0);
  await context.setOffline(true);
  await editAmount(page, id, '33,00', 'Banco (ARS)');

  await archiveAccount(email, 'Banco');
  await context.setOffline(false);

  const row = page.locator(`li:has(a[href$="id=${id}"])`);
  await expect(row).toContainText(t.list.failed, { timeout: 30_000 });
  await expect(row).toContainText(es.errors.accountArchived);
  await expect(page.getByRole('link', { name: '1 cambio no se sincronizó' })).toBeVisible();

  await row.getByRole('button', { name: new RegExp(`^${t.list.actions.discard} `) }).click();
  await expect(page.getByText(t.list.failed, { exact: true })).toHaveCount(0);
  expect(await movementAmount(id)).not.toBe('3300');
});

test('while the API answers 500 the edit stays pending, and it is sent once the API recovers (AC-06)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sync-retry');
  await waitForCachedEditScreen(page);
  await page.goto('/es/movements');
  const id = await idOfRow(page, 0);
  await context.setOffline(true);
  await editAmount(page, id, '44,00');

  const failing = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, body: '{}' });
    else await route.fallback();
  };
  await page.route(`**/movements/${id}`, failing);
  await context.setOffline(false);

  await expect(waiting(page)).toHaveText('1 cambio esperando sincronizarse');
  await expect(rows(page).first()).toContainText(t.list.pending);
  await page.unroute(`**/movements/${id}`, failing);

  // The backoff waits 5 s, then 10 s: the next attempts reach the recovered API.
  await expect(waiting(page)).toHaveCount(0, { timeout: 45_000 });
  expect(await movementAmount(id)).toBe('4400');
});
