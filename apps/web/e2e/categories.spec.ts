import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';

const API_URL = 'http://localhost:4000';

const es = catalogs.es;
const t = es.categories;

const PARENT_NAME = 'Mascotas';
const CHILD_NAME = 'Veterinaria';
const RENAMED_NAME = 'Movilidad';

// The flows must not trip over console errors or API failures that no test expects.
const consoleErrors: string[] = [];
let unexpectedStatuses: string[] = [];
let allowedStatuses: number[] = [];

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
      !allowedStatuses.includes(response.status()) &&
      // Signed-out probes of the session endpoint answer 401 before sign-in, by design.
      !response.url().includes('/auth/')
    ) {
      unexpectedStatuses.push(`${response.status()} ${response.url()}`);
    }
  });
}

// The emails link to the browser's language, and the helpers read the Spanish copy.
test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async ({ page }) => {
  await resetAttemptLimits();
  consoleErrors.length = 0;
  unexpectedStatuses = [];
  allowedStatuses = [];
  guard(page);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
  expect(unexpectedStatuses).toEqual([]);
});

async function signedInUser(page: Page, label: string): Promise<void> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

async function openCategories(page: Page, locale: 'es' | 'en'): Promise<void> {
  await page.goto(`/${locale}/categories`);
  await expect(
    page.getByRole('heading', { level: 1, name: catalogs[locale].categories.title }),
  ).toBeVisible();
  // The list loads after the page: its region marks it as ready.
  await expect(
    page.getByRole('region', { name: catalogs[locale].categories.list.activeTitle }),
  ).toBeVisible();
}

/** Shows the expense or the income tab of the list. */
async function showKind(page: Page, locale: 'es' | 'en', kind: 'expense' | 'income') {
  await page
    .getByRole('button', { name: catalogs[locale].categories.sections[kind], exact: true })
    .click();
}

function row(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true });
}

/** Opens the row's actions ("⋯") when they are closed and runs one of them. */
async function rowAction(page: Page, action: string, name: string): Promise<void> {
  const toggle = page.getByRole('button', {
    name: t.actions.more.replace('{name}', name),
    exact: true,
  });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await row(page, name)
    .getByRole('button', { name: `${action} ${name}`, exact: true })
    .click();
}

interface NewCategory {
  name: string;
  /** The label of the parent option; left out for a top-level category. */
  parent?: string;
}

async function fillCategoryForm(page: Page, category: NewCategory): Promise<void> {
  // The form waits behind "New" and closes after each category it creates.
  const open = page.getByRole('button', { name: t.new.open, exact: true });
  if (await open.isVisible()) await open.click();
  if (category.parent !== undefined) {
    await page
      .getByLabel(t.fields.parent, { exact: true })
      .selectOption({ label: category.parent });
  }
  await page.getByLabel(t.fields.name, { exact: true }).fill(category.name);
  await page.getByRole('radio', { name: t.icons.car, exact: true }).check({ force: true });
  await page.getByRole('radio', { name: t.colors.blue, exact: true }).check({ force: true });
  await page.getByRole('button', { name: t.form.submit }).click();
}

async function createCategory(page: Page, category: NewCategory): Promise<void> {
  await fillCategoryForm(page, category);
  await expect(row(page, category.name)).toBeVisible();
}

test('the Spanish and English defaults render for the same user (AC-01, AC-14, AC-15, AC-17)', async ({
  page,
}) => {
  await signedInUser(page, 'categories-defaults');

  // Each kind has its own tab of the list.
  for (const locale of ['es', 'en'] as const) {
    await openCategories(page, locale);
    for (const kind of ['expense', 'income'] as const) {
      await showKind(page, locale, kind);
      const defaults = DEFAULT_CATEGORIES.filter((category) => category.kind === kind);
      for (const category of defaults) {
        await expect(row(page, category.names[locale])).toBeVisible();
      }
      // Names that differ between the languages never show in the other one.
      const other = locale === 'es' ? 'en' : 'es';
      for (const category of defaults) {
        if (category.names.es !== category.names.en) {
          await expect(row(page, category.names[other])).toHaveCount(0);
        }
      }
    }
  }
});

test('a renamed default keeps its custom name after the language switch while its siblings translate (AC-16, AC-17)', async ({
  page,
}) => {
  await signedInUser(page, 'categories-rename');
  await openCategories(page, 'es');

  const original = defaultCategoryName('transport', 'es');
  await rowAction(page, t.actions.edit, original);
  await page
    .getByLabel(t.actions.editField.replace('{name}', original), { exact: true })
    .fill(RENAMED_NAME);
  await page.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(row(page, RENAMED_NAME)).toBeVisible();
  await expect(row(page, original)).toHaveCount(0);

  await openCategories(page, 'en');
  await expect(row(page, RENAMED_NAME)).toBeVisible();
  await expect(row(page, defaultCategoryName('transport', 'en'))).toHaveCount(0);
  await expect(row(page, defaultCategoryName('home', 'en'))).toBeVisible();
  await expect(row(page, defaultCategoryName('home', 'es'))).toHaveCount(0);

  await openCategories(page, 'es');
  await expect(row(page, RENAMED_NAME)).toBeVisible();
  await expect(row(page, defaultCategoryName('home', 'es'))).toBeVisible();
});

test('a category and a subcategory are created; a duplicate and a default-translation name show an error (AC-02, AC-11)', async ({
  page,
}) => {
  await signedInUser(page, 'categories-create');
  await openCategories(page, 'es');

  await createCategory(page, { name: PARENT_NAME });
  await createCategory(page, { name: CHILD_NAME, parent: PARENT_NAME });
  await expect(
    row(page, PARENT_NAME)
      .getByRole('list', { name: t.list.subcategories.replace('{name}', PARENT_NAME) })
      .getByRole('listitem', { name: CHILD_NAME, exact: true }),
  ).toBeVisible();

  allowedStatuses = [409];
  await fillCategoryForm(page, { name: PARENT_NAME.toLowerCase() });
  await expect(page.getByText(es.errors.categoryNameTaken)).toBeVisible();
  await expect(row(page, PARENT_NAME.toLowerCase())).toHaveCount(0);

  // The English translation of a default is taken too, even while the page is in Spanish.
  await page.getByLabel(t.fields.name, { exact: true }).fill(defaultCategoryName('food', 'en'));
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByText(es.errors.categoryNameTaken)).toBeVisible();
  await expect(row(page, defaultCategoryName('food', 'en'))).toHaveCount(0);
});

test('archive, unarchive and delete update the list; a parent with subcategories cannot be deleted (AC-06, AC-07, AC-08, AC-09, AC-10)', async ({
  page,
}) => {
  await signedInUser(page, 'categories-lifecycle');
  await openCategories(page, 'es');
  await createCategory(page, { name: PARENT_NAME });
  await createCategory(page, { name: CHILD_NAME, parent: PARENT_NAME });

  // Archiving the parent takes its subcategory with it.
  await rowAction(page, t.actions.archive, PARENT_NAME);
  await expect(row(page, PARENT_NAME)).toHaveCount(0);
  await expect(row(page, CHILD_NAME)).toHaveCount(0);

  await page.getByRole('button', { name: t.list.viewArchived, exact: true }).click();
  await expect(page.getByRole('region', { name: t.list.archivedTitle })).toBeVisible();
  await expect(row(page, PARENT_NAME)).toBeVisible();
  await expect(row(page, CHILD_NAME)).toBeVisible();

  // Unarchiving the parent restores only the parent; the subcategory stays archived.
  await rowAction(page, t.actions.unarchive, PARENT_NAME);
  await expect(row(page, PARENT_NAME)).toHaveCount(0);
  await expect(row(page, CHILD_NAME)).toBeVisible();
  await rowAction(page, t.actions.unarchive, CHILD_NAME);
  await expect(row(page, CHILD_NAME)).toHaveCount(0);
  await expect(page.getByText(t.list.emptyArchived)).toBeVisible();

  await page.getByRole('button', { name: t.list.emptyArchivedAction, exact: true }).click();
  await expect(row(page, PARENT_NAME)).toBeVisible();
  await expect(row(page, CHILD_NAME)).toBeVisible();

  // A parent that still has a subcategory is refused and kept.
  allowedStatuses = [409];
  await rowAction(page, t.actions.delete, PARENT_NAME);
  await row(page, PARENT_NAME).getByRole('button', { name: t.actions.confirmDeleteYes }).click();
  await expect(page.getByText(es.errors.categoryInUse)).toBeVisible();
  await expect(row(page, PARENT_NAME)).toBeVisible();

  // Unused categories go away, the subcategory first and then its parent.
  await rowAction(page, t.actions.delete, CHILD_NAME);
  await row(page, CHILD_NAME).getByRole('button', { name: t.actions.confirmDeleteYes }).click();
  await expect(row(page, CHILD_NAME)).toHaveCount(0);
  await rowAction(page, t.actions.delete, PARENT_NAME);
  await row(page, PARENT_NAME).getByRole('button', { name: t.actions.confirmDeleteYes }).click();
  await expect(row(page, PARENT_NAME)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('region', { name: t.list.activeTitle })).toBeVisible();
  await expect(row(page, PARENT_NAME)).toHaveCount(0);
  await expect(row(page, CHILD_NAME)).toHaveCount(0);
});

test("a second user never sees the first user's categories (AC-13)", async ({ page, browser }) => {
  await signedInUser(page, 'categories-owner');
  await openCategories(page, 'es');
  await createCategory(page, { name: PARENT_NAME });

  const other = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  try {
    const otherPage = await other.newPage();
    guard(otherPage);
    await signedInUser(otherPage, 'categories-stranger');
    await openCategories(otherPage, 'es');

    await expect(row(otherPage, defaultCategoryName('food', 'es'))).toBeVisible();
    await expect(row(otherPage, PARENT_NAME)).toHaveCount(0);
  } finally {
    await other.close();
  }

  await openCategories(page, 'es');
  await expect(row(page, PARENT_NAME)).toBeVisible();
});
