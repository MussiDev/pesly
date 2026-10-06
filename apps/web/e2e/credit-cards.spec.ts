import { firstOpenPeriod, statementDatesFor, todayInTimeZone } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const PASSWORD = 'correct horse battery staple';
const es = catalogs.es;
const t = es.creditCards;

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

const formatDay = (date: string) =>
  new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

const formatMonth = (period: string) =>
  new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${period}-01T00:00:00Z`),
  );

/** The next calendar day of a `YYYY-MM-DD` date. */
function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('creates a card with its two accounts, moves a statement date and keeps the linked accounts (AC-01, AC-03, AC-06, FR-02)', async ({
  page,
}) => {
  await signedInUser(page, 'cards');

  await page.goto('/es/cards/new');
  await page.getByLabel(t.form.name).fill('Visa');
  await page.getByLabel(t.form.closingDay).fill('24');
  await page.getByLabel(t.form.dueDay).fill('5');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/cards$/);
  const card = page.getByRole('listitem', { name: 'Visa', exact: true });
  await expect(card).toBeVisible();

  await page.goto('/es/accounts');
  await expect(page.getByRole('listitem', { name: 'Visa ARS', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Visa USD', exact: true })).toBeVisible();

  // The app computes "today" in the user's zone; Buenos Aires is the default for a new user.
  const today = todayInTimeZone(new Date(), 'America/Argentina/Buenos_Aires');
  const period = firstOpenPeriod(today, 24);
  const { closingDate } = statementDatesFor(period, 24, 5);
  const moved = nextDay(closingDate);

  await page.goto('/es/cards');
  await card.getByRole('link').click();
  const statement = page.getByRole('listitem', { name: formatMonth(period), exact: true });
  await expect(statement.getByText(t.detail.open)).toBeVisible();
  await statement.getByRole('button', { name: t.detail.edit }).click();
  await statement.getByLabel(t.detail.closingDate).fill(moved);
  await statement.getByRole('button', { name: t.detail.save }).click();
  await expect(
    statement.getByText(t.detail.closes.replace('{date}', formatDay(moved))),
  ).toBeVisible();

  // Sad path: a linked account cannot be deleted on its own from the accounts page.
  await page.goto('/es/accounts');
  const linked = page.getByRole('listitem', { name: 'Visa ARS', exact: true });
  await linked
    .getByRole('button', { name: `${es.accounts.actions.delete} Visa ARS`, exact: true })
    .click();
  await page.getByRole('button', { name: es.accounts.actions.confirmDeleteYes }).click();
  await expect(page.getByText(es.errors.accountLinkedToCard)).toBeVisible();
  await expect(linked).toBeVisible();
});
