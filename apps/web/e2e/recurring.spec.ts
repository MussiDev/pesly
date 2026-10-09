import {
  DEFAULT_CATEGORIES,
  addDays,
  defaultCategoryName,
  formatMoney,
  todayInTimeZone,
} from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';

const es = catalogs.es;
const t = es.recurring;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

test.beforeEach(async () => {
  await resetAttemptLimits();
});

async function signedInUser(page: Page, label: string): Promise<void> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

async function createArsAccount(page: Page, name: string): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(es.accounts.fields.name).fill(name);
  await page
    .getByLabel(es.accounts.fields.type)
    .selectOption({ label: es.accounts.types.bank_account });
  await page
    .getByLabel(es.accounts.fields.currency)
    .selectOption({ label: es.accounts.currencies.ARS });
  await page.getByRole('button', { name: es.accounts.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
}

test('creates a monthly payment dated in the past, sees it overdue, confirms it with another amount and finds the expense (AC-01, AC-07, AC-10)', async ({
  page,
}) => {
  await signedInUser(page, 'recurring');
  await createArsAccount(page, 'Galicia');

  // The app computes "today" in the user's zone; Buenos Aires is the default for a new user.
  const today = todayInTimeZone(new Date(), 'America/Argentina/Buenos_Aires');
  const start = addDays(today, -3);
  // The day field takes a plain number: no leading zero.
  const dayOfMonth = start.slice(8).replace(/^0/, '');

  await page.goto('/es/recurring/new');
  await page.getByLabel(t.fields.name).fill('Alquiler');
  await page.getByLabel(t.fields.amount, { exact: true }).fill('350000,00');
  await page.getByLabel(t.fields.account).selectOption({ label: 'Galicia (ARS)' });
  await page.getByLabel(t.fields.category).selectOption({ label: EXPENSE_CATEGORY });
  await page.getByLabel(t.frequency.label).selectOption('monthly');
  await page.getByLabel(t.fields.dayOfMonth).fill(dayOfMonth);
  await page.getByLabel(t.fields.startDate).fill(start);
  await page.getByLabel(t.mode.label).selectOption({ label: t.mode.confirmation });
  await page.getByRole('button', { name: t.actions.create }).click();
  await expect(page).toHaveURL(/\/es\/recurring$/);

  const upcoming = page.getByRole('list', { name: t.list.upcomingLabel });
  const row = upcoming.getByRole('listitem', { name: 'Alquiler', exact: true });
  await expect(row.getByText(t.status.overdue)).toBeVisible();

  await row.getByRole('button', { name: `${t.actions.confirm} Alquiler`, exact: true }).click();
  const amount = page.getByLabel(t.confirm.amount);
  await expect(amount).toHaveValue(/350\.000,00/);
  await amount.fill('48250,00');
  await page.getByRole('button', { name: t.confirm.submit }).click();

  // Nothing is left to confirm; the next occurrence, if shown, is only scheduled.
  await expect(
    page.getByRole('button', { name: `${t.actions.confirm} Alquiler`, exact: true }),
  ).toHaveCount(0);

  await page.goto('/es/movements');
  const expense = page.getByRole('listitem').filter({ hasText: 'Galicia' });
  await expect(expense).toHaveCount(1);
  await expect(expense).toContainText(formatMoney(4825000n, 'ARS', 'es'));
  await expect(expense).toContainText(EXPENSE_CATEGORY);
});

test('refuses a payment without a name or a day and creates nothing (AC-02)', async ({ page }) => {
  await signedInUser(page, 'recurring-invalid');
  await createArsAccount(page, 'Galicia');

  await page.goto('/es/recurring/new');
  await page.getByRole('button', { name: t.actions.create }).click();
  await expect(page.getByText(t.errors.nameRequired)).toBeVisible();
  await expect(page.getByText(t.errors.dayOfMonthRequired)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/recurring\/new$/);

  await page.goto('/es/recurring');
  await expect(page.getByText(t.list.emptyTitle)).toBeVisible();
});
