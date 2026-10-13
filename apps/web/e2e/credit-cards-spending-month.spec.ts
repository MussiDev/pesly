import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { moveFirstStatementDueToThisMonth, resetAttemptLimits } from './support/database';
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

const note = es.cardPurchasesNote.text;

test('a card purchase counts as spending in the month its statement is due (FEAT-010 AC-01, AC-06, AC-13)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-spending-month');
  await createBank(page);
  const cardId = await createVisa(page);
  await spend(page, cardId, '30.000,00');

  // The purchase is dated today but its statement is due in a later month: it is in the movements
  // list and not in this month's spending, and the screens say why.
  await page.goto('/es/movements');
  await expect(page.getByText(/30.000,00/).first()).toBeVisible();
  await page.goto('/es/reports/categories');
  await expect(page.getByText(note)).toBeVisible();
  await expect(page.getByText(es.reports.states.emptyTitle)).toBeVisible();
  await page.goto('/es');
  await expect(page.getByText(note)).toBeVisible();

  // Once the statement is due this month, the same purchase counts as this month's spending.
  await moveFirstStatementDueToThisMonth(email, 'Visa');
  await page.goto('/es/reports/categories');
  await expect(page.getByText(es.reports.states.emptyTitle)).toHaveCount(0);
  await expect(page.getByText(/30.000,00/).first()).toBeVisible();
});
