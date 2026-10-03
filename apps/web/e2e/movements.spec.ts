import { DEFAULT_CATEGORIES, defaultCategoryName, formatMoney } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { formatRate } from '../src/features/movements/format-rate';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import {
  movementsOf,
  resetAttemptLimits,
  withAgedRates,
  withoutStoredRates,
} from './support/database';

const API_URL = 'http://localhost:4000';

const es = catalogs.es;
const t = es.movements;
const accountsCatalog = es.accounts;

const ACCOUNT_NAME = 'Caja';
const ACCOUNT_OPTION = `${ACCOUNT_NAME} (ARS)`;

function firstRootCategory(kind: 'expense' | 'income'): string {
  const entry = DEFAULT_CATEGORIES.find((item) => item.kind === kind && item.parentKey === null);
  if (entry === undefined) throw new Error(`No default ${kind} category`);
  return defaultCategoryName(entry.key, 'es');
}

const EXPENSE_CATEGORY = firstRootCategory('expense');
const INCOME_CATEGORY = firstRootCategory('income');

function money(minor: bigint): string {
  return formatMoney(minor, 'ARS', 'es');
}

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

async function signedInUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  return email;
}

async function createArsAccount(page: Page, openingBalance: string): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsCatalog.fields.name).fill(ACCOUNT_NAME);
  await page.getByLabel(accountsCatalog.fields.type).selectOption({
    label: accountsCatalog.types.cash,
  });
  await page.getByLabel(accountsCatalog.fields.currency).selectOption({
    label: accountsCatalog.currencies.ARS,
  });
  await page.getByLabel(accountsCatalog.fields.openingBalance).fill(openingBalance);
  await page.getByRole('button', { name: accountsCatalog.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
  await expect(accountRow(page)).toBeVisible();
}

function accountRow(page: Page) {
  return page.getByRole('listitem', { name: ACCOUNT_NAME, exact: true });
}

function accountButton(page: Page, action: string) {
  return accountRow(page).getByRole('button', {
    name: `${action} ${ACCOUNT_NAME}`,
    exact: true,
  });
}

interface MovementEntry {
  type: 'expense' | 'income';
  category: string;
  amount: string;
  /** `YYYY-MM-DDTHH:mm`; left out to keep the pre-filled "now". */
  occurredAt?: string;
  /** Typed as is; left out to keep the pre-filled rate. */
  rate?: string;
}

/** Opens the entry screen and fills it; the caller submits. */
async function fillMovement(page: Page, entry: MovementEntry): Promise<void> {
  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: ACCOUNT_OPTION });
  await page
    .getByLabel(t.fields.type, { exact: true })
    .selectOption({ label: t.types[entry.type] });
  await page.getByLabel(t.fields.category, { exact: true }).selectOption({ label: entry.category });
  await page.getByLabel(t.fields.amount, { exact: true }).fill(entry.amount);
  if (entry.occurredAt !== undefined) {
    await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(entry.occurredAt);
  }
  if (entry.rate !== undefined) {
    await page.getByLabel(t.fields.rate, { exact: true }).fill(entry.rate);
  }
}

function submit(page: Page) {
  return page.getByRole('button', { name: t.form.submit });
}

function savedRate(rate: string): string {
  return t.saved.rate.replace('{rate}', rate);
}

test('records an expense and an income, lists them newest first, shows the balance and keeps the account (AC-01, AC-04, AC-12, AC-13, AC-14, AC-18)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-flow');
  await createArsAccount(page, '1.000,00');

  // The expense keeps the pre-filled stored rate and is dated in the past, so the list order is
  // decided by the date and not by the minute both were typed in.
  await fillMovement(page, {
    type: 'expense',
    category: EXPENSE_CATEGORY,
    amount: '100,00',
    occurredAt: '2026-09-01T10:00',
  });
  await expect(page.getByLabel(t.fields.rate, { exact: true })).not.toHaveValue('');
  await submit(page).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
  // The entry form comes back empty, ready for the next movement.
  await expect(page.getByLabel(t.fields.amount, { exact: true })).toHaveValue('');

  // The income types its own rate.
  await fillMovement(page, {
    type: 'income',
    category: INCOME_CATEGORY,
    amount: '250,50',
    rate: '1500,50',
  });
  await submit(page).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: savedRate(formatRate(15_005_000n, 'es')) }),
  ).toBeVisible();

  const stored = await movementsOf(email);
  expect(stored.map((movement) => [movement.type, movement.amount, movement.rateSource])).toEqual([
    ['expense', '10000', 'automatic'],
    ['income', '25050', 'manual'],
  ]);
  expect(stored[1]?.rate).toBe('15005000');

  await page.goto('/es/movements');
  const rows = page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME });
  await expect(rows).toHaveCount(2);
  // Direction is a data-kind contract of Amount (glyph and sr-only label, not colour alone); the
  // figure is the magnitude.
  const incomeAmount = rows.nth(0).locator('[data-slot="amount"]');
  await expect(incomeAmount).toHaveAttribute('data-kind', 'income');
  await expect(incomeAmount).toContainText(money(25_050n));
  await expect(rows.nth(0)).toContainText(INCOME_CATEGORY);
  await expect(rows.nth(0)).toContainText(ACCOUNT_NAME);
  const expenseAmount = rows.nth(1).locator('[data-slot="amount"]');
  await expect(expenseAmount).toHaveAttribute('data-kind', 'expense');
  await expect(expenseAmount).toContainText(money(10_000n));
  await expect(rows.nth(1)).toContainText(EXPENSE_CATEGORY);
  // The account is in pesos: the frozen rate stays stored (checked above) and the row hides it.
  const rateWording = t.list.rate.split('{')[0] ?? '';
  await expect(page.getByText(rateWording)).toHaveCount(0);

  // 1.000,00 - 100,00 + 250,50.
  await page.goto('/es/accounts');
  await expect(accountRow(page)).toContainText(money(115_050n));

  // An account with movements cannot be deleted.
  allowedStatuses = [409];
  await accountButton(page, accountsCatalog.actions.delete).click();
  await page.getByRole('button', { name: accountsCatalog.actions.confirmDeleteYes }).click();
  await expect(page.getByText(es.errors.accountHasMovements)).toBeVisible();
  await page.reload();
  await expect(accountRow(page)).toBeVisible();
});

test('the entry screen refuses a zero amount and a missing account and saves nothing (AC-02, AC-03)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-invalid');
  await createArsAccount(page, '0');

  await page.goto('/es/movements/new');
  await submit(page).click();
  await expect(page.getByText(t.errors.accountRequired)).toBeVisible();
  await expect(page.getByText(t.errors.categoryRequired)).toBeVisible();
  await expect(page.getByText(t.errors.amountInvalid)).toBeVisible();

  await fillMovement(page, { type: 'expense', category: EXPENSE_CATEGORY, amount: '0' });
  await submit(page).click();
  await expect(page.getByText(t.errors.amountNotPositive)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/movements\/new$/);

  expect(await movementsOf(email)).toEqual([]);
});

test('with no stored rate the screen requires a manual one and saves it as manual (AC-20, AC-21)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-no-rate');
  await createArsAccount(page, '500,00');

  await withoutStoredRates(async () => {
    await fillMovement(page, { type: 'expense', category: EXPENSE_CATEGORY, amount: '10,00' });
    await expect(page.getByText(t.rate.missing)).toBeVisible();
    await expect(page.getByLabel(t.fields.rate, { exact: true })).toHaveValue('');

    // Saving without a rate is refused.
    await submit(page).click();
    await expect(page.getByText(t.errors.rateRequired)).toBeVisible();
    await expect(page.getByLabel(t.fields.rate, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(await movementsOf(email)).toEqual([]);

    await page.getByLabel(t.fields.rate, { exact: true }).fill('1250,50');
    await submit(page).click();
    await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: savedRate(formatRate(12_505_000n, 'es')) }),
    ).toBeVisible();
  });

  const stored = await movementsOf(email);
  expect(stored.map((movement) => [movement.rate, movement.rateSource])).toEqual([
    ['12505000', 'manual'],
  ]);
});

test('after the stored rates age in the database the screen shows the age message (AC-11)', async ({
  page,
}) => {
  await signedInUser(page, 'movements-age');
  await createArsAccount(page, '0');

  // Fresh rates show no age message.
  await page.goto('/es/movements/new');
  await expect(page.getByLabel(t.fields.rate, { exact: true })).not.toHaveValue('');
  // Any hour count: the message text with its placeholder opened up.
  const [before = '', after = ''] = t.rate.age.split('{hours}');
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anyAgeMessage = new RegExp(`${escape(before)}\\d+${escape(after)}`);
  await expect(page.getByText(anyAgeMessage)).toHaveCount(0);

  await withAgedRates(5, async () => {
    await page.goto('/es/movements/new');
    await expect(page.getByText(t.rate.age.replace('{hours}', '5'))).toBeVisible();
    // The aged rate still prefills the field: the message warns, it does not block.
    await expect(page.getByLabel(t.fields.rate, { exact: true })).not.toHaveValue('');
  });
});

test('a movement on an archived account is refused with the unarchive-first message and works after unarchiving (AC-25, AC-27)', async ({
  page,
  context,
}) => {
  const email = await signedInUser(page, 'movements-archived');
  await createArsAccount(page, '0');

  // The entry screen loads while the account is active; another tab archives it before saving.
  await fillMovement(page, { type: 'expense', category: EXPENSE_CATEGORY, amount: '20,00' });
  const other = await context.newPage();
  guard(other);
  try {
    await other.goto('/es/accounts');
    await accountButton(other, accountsCatalog.actions.archive).click();
    await expect(accountRow(other)).toHaveCount(0);

    allowedStatuses = [409];
    await submit(page).click();
    await expect(page.getByText(t.errors.accountArchived)).toBeVisible();
    await expect(page).toHaveURL(/\/es\/movements\/new$/);
    expect(await movementsOf(email)).toEqual([]);

    await other.getByRole('button', { name: accountsCatalog.list.showArchived }).click();
    await accountButton(other, accountsCatalog.actions.unarchive).click();
    await expect(accountRow(other)).toHaveCount(0);
  } finally {
    await other.close();
  }

  await submit(page).click();
  await expect(page.getByRole('status').filter({ hasText: t.saved.title })).toBeVisible();
  expect((await movementsOf(email)).map((movement) => movement.amount)).toEqual(['2000']);
});
