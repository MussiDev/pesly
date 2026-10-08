import { DEFAULT_CATEGORIES, defaultCategoryName, formatMoney } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { closeFirstStatement, resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const PASSWORD = 'correct horse battery staple';
const es = catalogs.es;
const t = es.creditCards;
const accountsT = es.accounts;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

async function signedInUser(page: Page, label: string): Promise<string> {
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
  return email;
}

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

const money = (minor: bigint) => formatMoney(minor, 'ARS', 'es');

test.beforeEach(async () => {
  await resetAttemptLimits();
});

async function createBank(page: Page): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsT.fields.name).fill('Banco');
  await page
    .getByLabel(accountsT.fields.type)
    .selectOption({ label: accountsT.types.bank_account });
  await page
    .getByLabel(accountsT.fields.currency)
    .selectOption({ label: accountsT.currencies.ARS });
  await page.getByRole('button', { name: accountsT.form.submit }).click();
  await expect(page.getByRole('listitem', { name: 'Banco', exact: true })).toBeVisible();
}

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

async function spend(page: Page, cardId: string, amount: string): Promise<void> {
  await page.goto(`/es/cards/${cardId}/expense`);
  await page.getByLabel(t.expense.fields.currency, { exact: true }).selectOption('ARS');
  await page.getByLabel(t.expense.fields.amount, { exact: true }).fill(amount);
  await page
    .getByLabel(t.expense.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.expense.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
}

async function pay(page: Page, cardId: string, amount: string): Promise<void> {
  await page.goto(`/es/cards/${cardId}/payments/new`);
  await page.getByLabel(t.payments.fields.sourceAccount, { exact: true }).selectOption({
    label: 'Banco',
  });
  await page.getByLabel(t.payments.fields.amount, { exact: true }).fill(amount);
  await page.getByRole('button', { name: t.payments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
}

const paymentLine = (status: string, amount: bigint) =>
  t.detail.paymentLine
    .replace('{currency}', 'ARS')
    .replace('{status}', status)
    .replace('{amount}', money(amount));

test('pays part of a closed statement and sees it partially paid, then pays the rest and sees it paid (AC-01, AC-03, AC-04)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-payments');
  await createBank(page);
  const cardId = await createVisa(page);
  await spend(page, cardId, '60.000,00');
  await closeFirstStatement(email, 'Visa');

  await page.goto(`/es/cards/${cardId}`);
  const closed = page.getByRole('listitem').filter({ hasText: t.detail.closed });
  await expect(closed).toContainText(paymentLine(t.detail.paymentStatus.unpaid, 0n));

  await pay(page, cardId, '20.000,00');
  await expect(closed).toContainText(
    paymentLine(t.detail.paymentStatus.partially_paid, 2_000_000n),
  );

  await pay(page, cardId, '40.000,00');
  await expect(closed).toContainText(paymentLine(t.detail.paymentStatus.paid, 6_000_000n));

  // The payments are transfers to the card account and show in the movements list.
  await page.goto('/es/movements');
  await expect(page.getByRole('listitem').filter({ hasText: 'Visa ARS' }).first()).toBeVisible();
});

test('the payment form refuses an empty amount and records nothing (AC-02)', async ({ page }) => {
  await signedInUser(page, 'card-payments-invalid');
  await createBank(page);
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}/payments/new`);
  await page.getByLabel(t.payments.fields.sourceAccount, { exact: true }).selectOption({
    label: 'Banco',
  });
  await page.getByRole('button', { name: t.payments.submit }).click();
  await expect(page.getByText(es.movements.errors.amountInvalid)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}/payments/new$`));
});
