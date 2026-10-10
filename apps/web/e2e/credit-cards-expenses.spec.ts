import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  firstOpenPeriod,
  formatMinorUnits,
  formatMoney,
  todayInTimeZone,
} from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const PASSWORD = 'correct horse battery staple';
const es = catalogs.es;
const t = es.creditCards;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

async function signedInUser(page: Page, label: string): Promise<void> {
  const email = uniqueEmail(label);
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.displayName).fill('Ana Pérez');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
  await expect(page).toHaveURL(/\/es$/);
}

const formatMonth = (period: string) =>
  new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${period}-01T00:00:00Z`),
  );

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

/** The statement list shows an amount, a non-breaking space and the currency code. */
const statementUsd = `${formatMinorUnits(1599n, 'es')}\u00a0USD`;

test.beforeEach(async () => {
  await resetAttemptLimits();
});

/** Creates the "Visa" card (closing day 24, due day 5) and returns its id from the list link. */
async function createVisa(page: Page): Promise<string> {
  await page.goto('/es/cards/new');
  await page.getByLabel(t.form.name).fill('Visa');
  await page.getByLabel(t.form.closingDay).fill('24');
  await page.getByLabel(t.form.dueDay).fill('5');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/cards$/);
  const href = await page
    .getByRole('listitem', { name: 'Visa', exact: true })
    .getByRole('link')
    .getAttribute('href');
  const id = /\/cards\/([^/?#]+)/.exec(href ?? '')?.[1];
  if (id === undefined) throw new Error(`No card id in the link: ${String(href)}`);
  return id;
}

/** The open statement row, as the app computes it: today in the Buenos Aires default zone. */
function openStatement(page: Page) {
  const today = todayInTimeZone(new Date(), 'America/Argentina/Buenos_Aires');
  return page.getByRole('listitem', { name: formatMonth(firstOpenPeriod(today, 24)), exact: true });
}

test('records a USD card expense and sees it in the open statement, the movements and the card account (AC-01, AC-04, AC-12)', async ({
  page,
}) => {
  await signedInUser(page, 'card-expense');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/expense`);
  await page.getByLabel(t.expense.fields.currency, { exact: true }).selectOption('USD');
  await page.getByLabel(t.expense.fields.amount, { exact: true }).fill('15,99');
  await page
    .getByLabel(t.expense.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.expense.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));

  await expect(openStatement(page)).toContainText(statementUsd);

  await page.goto('/es/movements');
  const row = page.getByRole('listitem').filter({ hasText: 'Visa USD' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(formatMoney(1599n, 'USD', 'es'));
  await expect(row).toContainText(EXPENSE_CATEGORY);

  await page.goto('/es/accounts');
  await expect(page.getByRole('listitem', { name: 'Visa USD', exact: true })).toBeVisible();
});

test('the card expense form refuses a missing amount and the statement total stays empty (AC-02)', async ({
  page,
}) => {
  await signedInUser(page, 'card-expense-invalid');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/expense`);
  await page.getByLabel(t.expense.fields.currency, { exact: true }).selectOption('USD');
  await page
    .getByLabel(t.expense.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.expense.submit }).click();
  await expect(page.getByText(es.movements.errors.amountInvalid)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}/expense$`));

  await page.goto(`/es/cards/${cardId}`);
  await expect(openStatement(page)).toBeVisible();
  await expect(openStatement(page)).not.toContainText(statementUsd);

  await page.goto('/es/movements');
  await expect(page.getByRole('listitem').filter({ hasText: 'Visa USD' })).toHaveCount(0);
});
