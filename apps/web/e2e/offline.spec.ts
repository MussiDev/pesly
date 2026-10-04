import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits, seedMovements } from './support/database';

const WEB_URL = 'http://localhost:3000';
const es = catalogs.es;
const t = es.movements;
const accountsCatalog = es.accounts;

const ACCOUNT_NAME = 'Caja';
const ACCOUNT_OPTION = `${ACCOUNT_NAME} (ARS)`;
const TAG = 'Viaje';
const SEEDED = 120;
const OFFLINE_ENTRY_BUDGET_MS = 1000;

const expenseCategory = DEFAULT_CATEGORIES.find(
  (item) => item.kind === 'expense' && item.parentKey === null,
);
if (expenseCategory === undefined) throw new Error('No default expense category');
const CATEGORY = defaultCategoryName(expenseCategory.key, 'es');

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

// The service worker is only built into a production build; a dev server would pass for the wrong
// reason, so the run fails before it starts instead.
test.beforeAll(() => {
  if (process.env.E2E_PRODUCTION_BUILD !== '1' && !process.env.CI) {
    throw new Error('The offline flows need a production build: run with E2E_PRODUCTION_BUILD=1');
  }
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

async function createAccountAndMovement(page: Page): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsCatalog.fields.name).fill(ACCOUNT_NAME);
  await page.getByLabel(accountsCatalog.fields.type).selectOption({
    label: accountsCatalog.types.cash,
  });
  await page.getByLabel(accountsCatalog.fields.currency).selectOption({
    label: accountsCatalog.currencies.ARS,
  });
  await page.getByLabel(accountsCatalog.fields.openingBalance).fill('1000,00');
  await page.getByRole('button', { name: accountsCatalog.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);

  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await page.getByLabel(t.fields.type, { exact: true }).selectOption({ label: t.types.expense });
  await page.getByLabel(t.fields.category, { exact: true }).selectOption({ label: CATEGORY });
  await page.getByLabel(t.fields.amount, { exact: true }).fill('10,00');
  await page.getByLabel(t.tags.label, { exact: true }).fill(TAG);
  await page.getByLabel(t.tags.label, { exact: true }).press('Enter');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
}

/** Signs in, records one movement, multiplies it and lets the worker keep both screens. */
async function prepareOnlineVisit(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await createAccountAndMovement(page);
  await seedMovements(email, SEEDED);

  // Online visits fill the device copy and the page cache.
  await page.goto('/es/movements');
  await expect(page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME }).first()).toBeVisible();
  await page.goto('/es/movements/new');
  await expect(page.getByLabel(t.fields.amount, { exact: true })).toBeVisible();
  // The first load registers the worker; a second one is controlled by it.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cache = await caches.open('pesly-pages-v1');
          const keys = await cache.keys();
          const paths = keys.map((key) => new URL(key.url).pathname);
          return paths.includes('/es/movements') && paths.includes('/es/movements/new');
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  return email;
}

function trackSameOriginFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('requestfailed', (request) => {
    // A request the page cancels itself (a prefetch left over from the page it just left) is not a
    // network failure.
    const error = request.failure()?.errorText ?? 'failed';
    if (request.url().startsWith(WEB_URL) && error !== 'net::ERR_ABORTED') {
      failures.push(`${error} ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(WEB_URL) && response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  return failures;
}

test('starts offline from the cached shell with the cached account and tags, fast and with no failed request (NFR-01, NFR-02, AC-04)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'offline-entry');

  const scope = await page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration('/');
    return found?.scope ?? null;
  });
  expect(scope).toBe(`${WEB_URL}/`);

  const failures = trackSameOriginFailures(page);
  await context.setOffline(true);

  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  await page.goto('/es/movements/new');
  await expect(page.getByLabel(t.fields.amount, { exact: true })).toBeVisible();
  const elapsed = Date.now() - started;
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(elapsed).toBeLessThan(OFFLINE_ENTRY_BUDGET_MS);

  await expect(
    page
      .getByLabel(t.fields.account, { exact: true })
      .getByRole('option', { name: ACCOUNT_OPTION }),
  ).toHaveCount(1);
  await page.getByLabel(t.tags.label, { exact: true }).fill('vi');
  await expect(
    page.getByRole('list', { name: t.tags.suggestions }).getByRole('button', { name: TAG }),
  ).toBeVisible();

  expect(failures).toEqual([]);
});

test('offline, the list shows the 100 most recent of the 120 seeded movements (AC-02)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'offline-list');
  const failures = trackSameOriginFailures(page);
  await context.setOffline(true);

  await page.goto('/es/movements');

  await expect(page.getByText(t.list.offlineNotice)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME })).toHaveCount(100);
  expect(failures).toEqual([]);
});

for (const outcome of ['denies', 'grants'] as const) {
  test(`a browser that ${outcome} persistent storage ${outcome === 'denies' ? 'shows' : 'hides'} the warning, with no console error (AC-06)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        errors.push(message.text());
      }
    });
    const grant = outcome === 'grants';
    await page.addInitScript((granted: boolean) => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: () => Promise.resolve(false),
          persist: () => Promise.resolve(granted),
        },
      });
    }, grant);

    const email = uniqueEmail(`storage-${outcome}`);
    await registerAndVerify(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/es$/);

    const warning = page.getByText(es.app.storageWarning);
    if (grant) {
      await page.waitForLoadState('networkidle');
      await expect(warning).toHaveCount(0);
    } else {
      await expect(warning).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
