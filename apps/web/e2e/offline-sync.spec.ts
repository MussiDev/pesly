import { expect, test, type Page } from '@playwright/test';
import { movementIdsOf, movementRowIds, resetAttemptLimits } from './support/database';
import {
  ACCOUNT_NAME,
  ACCOUNT_OPTION,
  CATEGORY,
  prepareOnlineVisit,
  requireProductionBuild,
  t,
  trackSameOriginFailures,
} from './support/offline-visit';
import { clearCachedRates, queuedIds, seedQueue } from './support/queue';
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

const savedOffline = (page: Page) =>
  page.getByRole('status').filter({ hasText: t.saved.titleOffline });
const pendingBadges = (page: Page) => page.getByText(t.list.pending, { exact: true });
const submit = (page: Page) => page.getByRole('button', { name: t.form.submit });

/** The rate is always typed, so a flow never depends on whether the copy has a stored rate. */
async function fillExpense(page: Page, amount: string, rate = '1250,50'): Promise<void> {
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await chooseMovementType(page, t.fields.type, t.types.expense);
  await page.getByLabel(t.fields.category, { exact: true }).selectOption({ label: CATEGORY });
  await page.getByLabel(t.fields.amount, { exact: true }).fill(amount);
  if (rate !== '') await page.getByLabel(t.fields.rate, { exact: true }).fill(rate);
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

test('offline, a user saves an expense and sees it in the list as pending (AC-01)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sync-expense');
  await context.setOffline(true);

  await page.goto('/es/movements/new');
  await fillExpense(page, '25,00');
  await submit(page).click();
  await expect(savedOffline(page)).toBeVisible();
  await expect(page.getByText(t.saved.pendingBody)).toBeVisible();

  await page.goto('/es/movements');
  await expect(page.getByText(t.list.offlineNotice)).toBeVisible();
  await expect(pendingBadges(page)).toHaveCount(1);
  // The pending row is the one with the badge. Its place among rows of the same minute is not
  // ordered, so the test finds it by what it shows and does not assume it is the first.
  const pendingRow = page.getByRole('listitem').filter({ hasText: t.list.pending });
  await expect(pendingRow).toHaveCount(1);
  await expect(pendingRow).toContainText(ACCOUNT_NAME);
  await expect(pendingRow).toContainText('25,00');
});

test('offline, a user saves a transfer and an exchange and sees both as pending (AC-02)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sync-between', [
    { name: 'Banco', currency: 'ARS' },
    { name: 'Dolares', currency: 'USD' },
  ]);
  await context.setOffline(true);
  await page.goto('/es/movements/new');

  await chooseMovementType(page, t.fields.type, t.types.transfer);
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await page
    .getByLabel(t.fields.destinationAccount, { exact: true })
    .selectOption({ label: 'Banco (ARS)' });
  await page.getByLabel(t.fields.amount, { exact: true }).fill('5,00');
  await submit(page).click();
  await expect.poll(() => queuedIds(page)).toHaveLength(1);

  await chooseMovementType(page, t.fields.type, t.types.exchange);
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await page
    .getByLabel(t.fields.destinationAccount, { exact: true })
    .selectOption({ label: 'Dolares (USD)' });
  await page.getByLabel(t.fields.amountOut, { exact: true }).fill('1.450,00');
  await page.getByLabel(t.fields.amountIn, { exact: true }).fill('1,00');
  await submit(page).click();
  await expect.poll(() => queuedIds(page)).toHaveLength(2);

  await page.goto('/es/movements');
  await expect(pendingBadges(page)).toHaveCount(2);
});

test('5 movements saved offline survive a reload, go out with no click when the connection returns, under their own ids and once each (AC-03, AC-04, AC-05, AC-06, FR-04)', async ({
  page,
  context,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-five');
  const before = (await movementRowIds(email)).length;
  const failures = trackSameOriginFailures(page);
  const consoleErrors = trackConsoleErrors(page);
  await context.setOffline(true);
  await page.goto('/es/movements/new');

  for (let n = 1; n <= 5; n += 1) {
    await fillExpense(page, `${n},00`);
    await submit(page).click();
    await expect.poll(() => queuedIds(page)).toHaveLength(n);
  }
  const waiting = await queuedIds(page);

  await page.reload();
  await page.goto('/es/movements');
  await expect(pendingBadges(page)).toHaveCount(5);
  expect(failures).toEqual([]);
  expect(consoleErrors).toEqual([]);

  await context.setOffline(false);
  await expect
    .poll(async () => (await movementRowIds(email)).length, { timeout: 30_000 })
    .toBe(before + 5);

  // The rows were stored under the ids the form generated on the device.
  const stored = await movementRowIds(email);
  for (const id of waiting) expect(stored).toContain(id);
  await expect(pendingBadges(page)).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => queuedIds(page)).toEqual([]);

  // Nothing is sent twice: the count stays where it landed.
  await page.waitForTimeout(2000);
  expect((await movementRowIds(email)).length).toBe(before + 5);
});

test('a response dropped after the server stored the movement leaves one row after the retry (AC-06)', async ({
  page,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-dropped');
  const before = (await movementRowIds(email)).length;
  let posts = 0;
  let dropped = false;
  await page.route(
    (url) => url.pathname === '/movements',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posts += 1;
      if (!dropped) {
        dropped = true;
        // The server stores the movement, and the answer never reaches the page.
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    },
  );

  await page.goto('/es/movements/new');
  await fillExpense(page, '77,00');
  await submit(page).click();

  await expect.poll(() => posts, { timeout: 20_000 }).toBe(2);
  await expect.poll(() => queuedIds(page), { timeout: 20_000 }).toEqual([]);
  await page.waitForTimeout(1500);
  expect((await movementRowIds(email)).length).toBe(before + 1);
});

test('an offline expense with no cached rate and no typed rate is refused and not saved (AC-07)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'sync-no-rate');
  await clearCachedRates(page);
  await context.setOffline(true);
  await page.goto('/es/movements/new');
  await expect(page.getByLabel(t.fields.rate, { exact: true })).toHaveValue('');

  await fillExpense(page, '40,00', '');
  await submit(page).click();

  await expect(page.getByText(t.errors.rateRequired)).toBeVisible();
  await expect(savedOffline(page)).toHaveCount(0);
  expect(await queuedIds(page)).toEqual([]);
});

test('100 pending movements are all stored in under 10 s on a 4G connection (NFR-02)', async ({
  page,
  context,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-speed');
  const ids = await movementIdsOf(email);
  const before = (await movementRowIds(email)).length;
  await seedQueue(page, { ...ids, count: 100 });

  // 10 Mbps down, 5 Mbps up and 50 ms of latency: the reference connection of the requirement.
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  });
  const started = Date.now();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pesly:movement-queued'));
  });

  await expect
    .poll(async () => (await movementRowIds(email)).length, { intervals: [100], timeout: 20_000 })
    .toBe(before + 100);
  const elapsed = Date.now() - started;
  expect(elapsed, `100 movements took ${elapsed} ms`).toBeLessThan(10_000);
});

test('1,000 pending movements are still in the queue after a reload (NFR-01)', async ({
  page,
  context,
}) => {
  const email = await prepareOnlineVisit(page, 'sync-thousand', [], 1);
  const ids = await movementIdsOf(email);
  await seedQueue(page, { ...ids, count: 1000 });
  // Offline, so nothing is sent while the page reloads.
  await context.setOffline(true);

  await page.reload();
  await expect(page.getByLabel(t.fields.amount, { exact: true })).toBeVisible();

  expect(await queuedIds(page)).toHaveLength(1000);
});
