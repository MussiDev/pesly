import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  firstOpenPeriod,
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

/** 120,000.00 ARS in 12 installments of 10,000.00 ARS, as the app formats them. */
const TOTAL = formatMoney(12_000_000n, 'ARS', 'es');
const EACH = formatMoney(1_000_000n, 'ARS', 'es');
const ZERO = formatMoney(0n, 'ARS', 'es');

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

test('records an installment purchase, sees the pending debt and the installment in the open statement, then deletes it (AC-01, AC-07, AC-08, AC-09)', async ({
  page,
}) => {
  await signedInUser(page, 'installments');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/installments/new`);
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill('120.000,00');
  await page.getByLabel(t.installments.fields.installments, { exact: true }).fill('12');
  await page
    .getByLabel(t.installments.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.installments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));

  const debt = page.getByText(t.installments.pendingDebt, { exact: true }).locator('..');
  await expect(debt).toContainText(TOTAL);
  await expect(openStatement(page)).toContainText(
    t.detail.installmentLine
      .replace('{number}', '1')
      .replace('{count}', '12')
      .replace('{amount}', EACH),
  );

  await page.getByRole('button', { name: t.installments.delete, exact: true }).click();
  await page.getByRole('button', { name: t.installments.confirmDelete }).click();
  await expect(page.getByText(t.installments.empty)).toBeVisible();
  await expect(debt).toContainText(ZERO);
  await expect(openStatement(page)).not.toContainText(
    t.detail.installmentLine
      .replace('{number}', '1')
      .replace('{count}', '12')
      .replace('{amount}', EACH),
  );
});

test('the purchase form refuses 61 installments and creates nothing (AC-02)', async ({ page }) => {
  await signedInUser(page, 'installments-invalid');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/installments/new`);
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill('1.000,00');
  await page.getByLabel(t.installments.fields.installments, { exact: true }).fill('61');
  await page
    .getByLabel(t.installments.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.installments.submit }).click();
  await expect(page.getByText(t.installments.errors.installmentsInvalid)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}/installments/new$`));

  await page.goto(`/es/cards/${cardId}`);
  await expect(page.getByText(t.installments.empty)).toBeVisible();
  await expect(
    page.getByText(t.installments.pendingDebt, { exact: true }).locator('..'),
  ).toContainText(ZERO);
});

test('one installment is saved as a plain card expense, not an installment purchase', async ({
  page,
}) => {
  await signedInUser(page, 'installments-single');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/installments/new`);
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill('1.000,00');
  await page.getByLabel(t.installments.fields.installments, { exact: true }).fill('1');
  await page
    .getByLabel(t.installments.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.installments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
  await expect(page.getByText(t.installments.empty)).toBeVisible();
});
