import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { movementIdsOf, movementsOf, resetAttemptLimits, tagsOf } from './support/database';

const API_URL = 'http://localhost:4000';

const es = catalogs.es;
const t = es.movements;
const accountsCatalog = es.accounts;

const ACCOUNT_NAME = 'Caja';
const ACCOUNT_OPTION = `${ACCOUNT_NAME} (ARS)`;

function categoryName(key: string): string {
  const entry = DEFAULT_CATEGORIES.find((item) => item.key === key);
  if (entry === undefined) throw new Error(`No default category ${key}`);
  return defaultCategoryName(entry.key, 'es');
}

// A parent with a subcategory, and a second parent, all expense defaults.
const PARENT_CATEGORY = categoryName('food');
const CHILD_CATEGORY = categoryName('food.groceries');
const OTHER_CATEGORY = categoryName('transport');

// The flows must not trip over console errors or API failures that no test expects.
const consoleErrors: string[] = [];
let unexpectedStatuses: string[] = [];

/** Records console errors and unexpected API statuses of `page` into the shared lists. */
function guard(page: Page): void {
  page.on('console', (message) => {
    // A refused request is also logged by the browser; it is judged by its status below.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('response', (response) => {
    if (
      response.url().startsWith(API_URL) &&
      response.status() >= 400 &&
      // Signed-out probes of the session endpoint answer 401 before sign-in, by design.
      !response.url().includes('/auth/')
    ) {
      unexpectedStatuses.push(`${response.status()} ${response.url()}`);
    }
  });
}

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async ({ page }) => {
  await resetAttemptLimits();
  consoleErrors.length = 0;
  unexpectedStatuses = [];
  guard(page);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
  expect(unexpectedStatuses).toEqual([]);
});

async function signedInUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  return email;
}

async function createArsAccount(page: Page): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsCatalog.fields.name).fill(ACCOUNT_NAME);
  await page.getByLabel(accountsCatalog.fields.type).selectOption({
    label: accountsCatalog.types.cash,
  });
  await page.getByLabel(accountsCatalog.fields.currency).selectOption({
    label: accountsCatalog.currencies.ARS,
  });
  await page.getByLabel(accountsCatalog.fields.openingBalance).fill('0');
  await page.getByRole('button', { name: accountsCatalog.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
}

function tagField(page: Page) {
  return page.getByLabel(t.tags.label, { exact: true });
}

/** Opens the entry screen and fills the required fields; tags and submit are up to the caller. */
async function fillMovement(
  page: Page,
  entry: { category: string; amount: string; occurredAt: string },
): Promise<void> {
  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await page.getByLabel(t.fields.type, { exact: true }).selectOption({ label: t.types.expense });
  await page.getByLabel(t.fields.category, { exact: true }).selectOption({ label: entry.category });
  await page.getByLabel(t.fields.amount, { exact: true }).fill(entry.amount);
  await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(entry.occurredAt);
}

async function addTag(page: Page, text: string): Promise<void> {
  await tagField(page).fill(text);
  await tagField(page).press('Enter');
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
}

function rows(page: Page) {
  return page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME });
}

test('saves tags, reuses a tag typed in another case, and filters the list by tag, category and dates (AC-01, AC-02, AC-03, AC-05)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'tags-flow');
  await createArsAccount(page);

  // First movement: two tags, in a subcategory of the parent.
  await fillMovement(page, {
    category: CHILD_CATEGORY,
    amount: '100,00',
    occurredAt: '2026-09-01T10:00',
  });
  await addTag(page, 'Viaje');
  await addTag(page, 'Trabajo');
  await expect(page.getByRole('list', { name: t.tags.chips }).getByRole('listitem')).toHaveCount(2);
  await save(page);

  // Second movement: the tag is typed in lower case; the stored one is suggested first.
  await fillMovement(page, {
    category: OTHER_CATEGORY,
    amount: '50,00',
    occurredAt: '2026-09-15T10:00',
  });
  await tagField(page).fill('viaje');
  await expect(
    page.getByRole('list', { name: t.tags.suggestions }).getByRole('button', { name: 'Viaje' }),
  ).toBeVisible();
  await tagField(page).press('Enter');
  await save(page);

  // One stored tag per distinct name, whatever the case it was typed in.
  expect(await tagsOf(email)).toEqual(['Trabajo', 'Viaje']);
  expect(await movementsOf(email)).toHaveLength(2);

  await page.goto('/es/movements');
  await expect(rows(page)).toHaveCount(2);
  // The row shows the stored spelling, not the typed one.
  await expect(rows(page).first().getByText('Viaje', { exact: true })).toBeVisible();
  await expect(page.getByText('viaje', { exact: true })).toHaveCount(0);

  // By tag: the case typed in the filter does not matter.
  await addTag(page, 'viaje');
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: t.tags.remove.replace('{tag}', 'viaje') }).click();
  await addTag(page, 'Trabajo');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(CHILD_CATEGORY);
  await page.getByRole('button', { name: t.filters.clear }).click();
  await expect(rows(page)).toHaveCount(2);

  // By parent category: its subcategory movement is included.
  await page.getByLabel(t.filters.category, { exact: true }).selectOption({
    label: PARENT_CATEGORY,
  });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(CHILD_CATEGORY);
  await page.getByLabel(t.filters.category, { exact: true }).selectOption({
    label: OTHER_CATEGORY,
  });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(OTHER_CATEGORY);
  await page.getByRole('button', { name: t.filters.clear }).click();
  await expect(rows(page)).toHaveCount(2);

  // By date range (a local day, both ends inclusive).
  await page.getByLabel(t.filters.from, { exact: true }).fill('2026-09-10');
  await page.getByLabel(t.filters.to, { exact: true }).fill('2026-09-20');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(OTHER_CATEGORY);
  await page.getByLabel(t.filters.from, { exact: true }).fill('2026-09-01');
  await page.getByLabel(t.filters.to, { exact: true }).fill('2026-09-01');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(CHILD_CATEGORY);

  // Clearing brings everything back.
  await page.getByRole('button', { name: t.filters.clear }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByLabel(t.filters.from, { exact: true })).toHaveValue('');
});

test('the tag field refuses an empty tag, a 31-character tag and an 11th tag (AC-04, AC-06)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'tags-limits');
  await createArsAccount(page);
  await page.goto('/es/movements/new');

  await tagField(page).press('Enter');
  await expect(page.getByText(t.tags.errors.empty)).toBeVisible();

  await addTag(page, 'a'.repeat(31));
  await expect(page.getByText(t.tags.errors.tooLong.replace('{max}', '30'))).toBeVisible();
  await expect(page.getByRole('list', { name: t.tags.chips })).toHaveCount(0);

  // 30 characters is the longest accepted.
  await addTag(page, 'b'.repeat(30));
  await expect(page.getByRole('list', { name: t.tags.chips }).getByRole('listitem')).toHaveCount(1);

  for (let index = 2; index <= 10; index += 1) await addTag(page, `etiqueta ${index}`);
  await expect(page.getByRole('list', { name: t.tags.chips }).getByRole('listitem')).toHaveCount(
    10,
  );
  await addTag(page, 'etiqueta 11');
  await expect(page.getByText(t.tags.errors.limit.replace('{limit}', '10'))).toBeVisible();
  await expect(page.getByRole('list', { name: t.tags.chips }).getByRole('listitem')).toHaveCount(
    10,
  );

  expect(await movementsOf(email)).toEqual([]);
  expect(await tagsOf(email)).toEqual([]);
});

test("a second user's list, filtered by the first user's tag, account and category, shows nothing (AC-07)", async ({
  page,
  browser,
}) => {
  const owner = await signedInUser(page, 'tags-owner');
  await createArsAccount(page);
  await fillMovement(page, {
    category: CHILD_CATEGORY,
    amount: '10,00',
    occurredAt: '2026-09-01T10:00',
  });
  await addTag(page, 'Privada');
  await save(page);
  const ids = await movementIdsOf(owner);
  expect(await tagsOf(owner)).toEqual(['Privada']);

  // The owner does see it.
  await page.goto('/es/movements?tag=Privada');
  await expect(rows(page)).toHaveCount(1);

  const context = await browser.newContext({
    baseURL: 'http://localhost:3000',
    locale: 'es-AR',
    timezoneId: 'America/Cordoba',
  });
  try {
    const stranger = await context.newPage();
    guard(stranger);
    await signedInUser(stranger, 'tags-stranger');
    for (const query of [
      'tag=Privada',
      `accountId=${ids.accountId}`,
      `categoryId=${ids.categoryId}`,
      `categoryId=${ids.categoryId}&tag=Privada&accountId=${ids.accountId}`,
    ]) {
      await stranger.goto(`/es/movements?${query}`);
      await expect(stranger.getByText(t.filters.noMatch)).toBeVisible();
      await expect(rows(stranger)).toHaveCount(0);
    }
    // The stranger's suggestions never contain the other user's tag.
    await stranger.goto('/es/movements/new');
    const answered = stranger.waitForResponse(
      (response) => response.url().startsWith(API_URL) && response.url().includes('/tags'),
    );
    await tagField(stranger).fill('pri');
    expect((await answered).status()).toBe(200);
    await expect(stranger.getByRole('list', { name: t.tags.suggestions })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
