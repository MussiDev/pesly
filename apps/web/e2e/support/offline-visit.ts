import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './accounts';
import { catalogs } from './catalogs';
import { seedMovements } from './database';
import { chooseCategory, chooseMovementType } from './movement-type';

export const WEB_URL = 'http://localhost:3000';
export const es = catalogs.es;
export const t = es.movements;
const accountsCatalog = es.accounts;

export const ACCOUNT_NAME = 'Caja';
export const ACCOUNT_OPTION = `${ACCOUNT_NAME} (ARS)`;
export const TAG = 'Viaje';
export const SEEDED = 120;

const expenseCategory = DEFAULT_CATEGORIES.find(
  (item) => item.kind === 'expense' && item.parentKey === null,
);
if (expenseCategory === undefined) throw new Error('No default expense category');
export const CATEGORY = defaultCategoryName(expenseCategory.key, 'es');

/** The service worker is only built into a production build; a dev server would pass for the wrong reason. */
export function requireProductionBuild(): void {
  if (process.env.E2E_PRODUCTION_BUILD !== '1' && !process.env.CI) {
    throw new Error('The offline flows need a production build: run with E2E_PRODUCTION_BUILD=1');
  }
}

export async function createAccount(
  page: Page,
  name: string,
  currency: 'ARS' | 'USD' = 'ARS',
): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsCatalog.fields.name).fill(name);
  await page.getByLabel(accountsCatalog.fields.type).selectOption({
    label: accountsCatalog.types.cash,
  });
  await page.getByLabel(accountsCatalog.fields.currency).selectOption({
    label: accountsCatalog.currencies[currency],
  });
  await page.getByLabel(accountsCatalog.fields.openingBalance).fill('1000,00');
  await page.getByRole('button', { name: accountsCatalog.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
}

export async function createAccountAndMovement(page: Page): Promise<void> {
  await createAccount(page, ACCOUNT_NAME);

  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await chooseMovementType(page, t.fields.type, t.types.expense);
  await chooseCategory(page, t.fields.category, CATEGORY);
  await page.getByLabel(t.fields.amount, { exact: true }).fill('10,00');
  await page.getByLabel(t.tags.label, { exact: true }).fill(TAG);
  await page.getByLabel(t.tags.label, { exact: true }).press('Enter');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
}

/**
 * Signs in, records one movement, multiplies it and lets the worker keep both screens. `extra` are
 * more accounts to create first, so the device copy has them for a transfer or an exchange.
 */
export async function prepareOnlineVisit(
  page: Page,
  label: string,
  extra: { name: string; currency: 'ARS' | 'USD' }[] = [],
  seeded: number = SEEDED,
): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await createAccountAndMovement(page);
  for (const account of extra) await createAccount(page, account.name, account.currency);
  await seedMovements(email, seeded);

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

export function trackSameOriginFailures(page: Page): string[] {
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
