import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { chooseCategory } from './support/movement-type';
import {
  cardStatementNotices,
  makeFirstStatementDueSoon,
  resetAttemptLimits,
  type CardStatementNotice,
} from './support/database';

const es = catalogs.es;
const t = es.creditCards;
const accountsT = es.accounts;
const noticesT = es.notices;

test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });

// The first run compiles every page of a cold `next dev`, and a flow waits for worker passes.
test.setTimeout(180_000);

const NOTICE_TIMEOUT_MS = 60_000;
/** Two passes of the worker at the 5 s interval set in playwright.config.ts, plus a margin. */
const TWO_PASSES_MS = 12_000;

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

/** What the notice text must never carry: the expense typed below, in the ways it can be written. */
const AMOUNT_TOKENS = ['60.000', '60000', '6000000'];

test.beforeEach(async () => {
  await resetAttemptLimits();
});

async function signedInUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  return email;
}

async function createBank(page: Page): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsT.fields.name).fill('Banco');
  await page
    .getByLabel(accountsT.fields.type)
    .selectOption({ label: accountsT.types.bank_account });
  await page
    .getByLabel(accountsT.fields.currency)
    .selectOption({ label: accountsT.currencies.ARS });
  await page.getByLabel(accountsT.fields.openingBalance).fill('100.000,00');
  await page.getByRole('button', { name: accountsT.form.submit }).click();
  await expect(page.getByRole('listitem', { name: 'Banco', exact: true })).toBeVisible();
}

/** Creates a card (closing day 24, due day 5) from the form and returns its id from the list link. */
async function createCard(page: Page, name: string, reminderDays: string): Promise<string> {
  await page.goto('/es/cards/new');
  await page.getByLabel(t.form.name).fill(name);
  await page.getByLabel(t.form.closingDay).fill('24');
  await page.getByLabel(t.form.dueDay).fill('5');
  await page.getByLabel(t.form.reminderDays, { exact: true }).fill(reminderDays);
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/cards$/);
  const href = await page
    .getByRole('listitem', { name, exact: true })
    .getByRole('link')
    .getAttribute('href');
  const id = /\/cards\/([^/?#]+)/.exec(href ?? '')?.[1];
  if (id === undefined) throw new Error(`No card id in the link: ${String(href)}`);
  // Opening the card creates its statements, which the helpers then move.
  await page.goto(`/es/cards/${id}`);
  await expect(page.getByRole('heading', { name: t.detail.statements })).toBeVisible();
  return id;
}

async function spend(page: Page, cardId: string, amount: string): Promise<void> {
  await page.goto(`/es/cards/${cardId}/expense`);
  await page.getByLabel(t.expense.fields.currency, { exact: true }).selectOption('ARS');
  await page.getByLabel(t.expense.fields.amount, { exact: true }).fill(amount);
  await chooseCategory(page, t.expense.fields.category, EXPENSE_CATEGORY);
  await page.getByRole('button', { name: t.expense.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
}

async function buyInInstallments(
  page: Page,
  cardId: string,
  amount: string,
  installments: string,
): Promise<void> {
  await page.goto(`/es/cards/${cardId}/installments/new`);
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill(amount);
  await page.getByLabel(t.installments.fields.installments, { exact: true }).fill(installments);
  await chooseCategory(page, t.installments.fields.category, EXPENSE_CATEGORY);
  await page.getByRole('button', { name: t.installments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
}

async function payFromBank(page: Page, cardId: string, amount: string): Promise<void> {
  await page.goto(`/es/cards/${cardId}/payments/new`);
  await page.getByLabel(t.payments.fields.sourceAccount, { exact: true }).selectOption({
    label: 'Banco',
  });
  await page.getByLabel(t.payments.fields.amount, { exact: true }).fill(amount);
  await page.getByRole('button', { name: t.payments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));
}

/** Waits for the worker to create a notice naming the card; fails naming the card if it never does. */
async function waitForNotice(email: string, cardName: string): Promise<CardStatementNotice[]> {
  const mentionsCard = (notice: CardStatementNotice) => notice.text.includes(cardName);
  await expect
    .poll(async () => (await cardStatementNotices(email)).some(mentionsCard), {
      message: `The worker never created a statement reminder for the card "${cardName}" of ${email}`,
      timeout: NOTICE_TIMEOUT_MS,
      intervals: [1_000],
    })
    .toBe(true);
  return cardStatementNotices(email);
}

test('creates a card with 7 reminder days and after a worker pass the notices page shows one unread reminder naming it and no amount (AC-01, AC-02, AC-08)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-reminder');
  const cardId = await createCard(page, 'Visa', '7');
  await spend(page, cardId, '60.000,00');
  await makeFirstStatementDueSoon(email, 'Visa');

  await page.goto(`/es/cards/${cardId}`);
  await expect(page.getByLabel(t.detail.reminderDays, { exact: true })).toHaveValue('7');

  const notices = await waitForNotice(email, 'Visa');
  expect(notices).toHaveLength(1);
  expect(notices[0]).toEqual(expect.objectContaining({ unread: true }));
  for (const token of AMOUNT_TOKENS) expect(notices[0]?.text).not.toContain(token);

  await page.goto('/es');
  const link = page.getByRole('link', { name: noticesT.linkLabel.replace('{count}', '1') });
  await expect(link.first()).toBeVisible();
  await link.first().click();
  await expect(page).toHaveURL(/\/es\/notices$/);
  const notice = page.getByRole('button', { name: /El resumen de Visa vence el/ });
  await expect(notice).toHaveCount(1);
  for (const token of AMOUNT_TOKENS) await expect(notice).not.toContainText(token);
});

test('a card with no total records no notice while the other card notice appears, and later passes leave exactly one (FR-03, AC-06)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-reminder-empty');
  // Created first, so the worker meets it before the card that has a total.
  await createCard(page, 'Sin gastos', '7');
  await makeFirstStatementDueSoon(email, 'Sin gastos');
  const visaId = await createCard(page, 'Visa', '7');
  await spend(page, visaId, '60.000,00');
  await makeFirstStatementDueSoon(email, 'Visa');

  await waitForNotice(email, 'Visa');
  await page.waitForTimeout(TWO_PASSES_MS);

  const notices = await cardStatementNotices(email);
  expect(notices).toHaveLength(1);
  expect(notices[0]?.text).toContain('Visa');
  expect(notices.some((notice) => notice.text.includes('Sin gastos'))).toBe(false);
});

test('a statement fully paid before its reminder day creates no notice while the other card notice appears (AC-04, sad path, no data)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-reminder-paid');
  await createBank(page);
  const paidId = await createCard(page, 'Pagada', '7');
  await spend(page, paidId, '60.000,00');
  await makeFirstStatementDueSoon(email, 'Pagada', { closed: true });
  await payFromBank(page, paidId, '60.000,00');
  const visaId = await createCard(page, 'Visa', '7');
  await spend(page, visaId, '60.000,00');
  await makeFirstStatementDueSoon(email, 'Visa');

  await waitForNotice(email, 'Visa');
  await page.waitForTimeout(TWO_PASSES_MS);

  const notices = await cardStatementNotices(email);
  expect(notices).toHaveLength(1);
  expect(notices.some((notice) => notice.text.includes('Pagada'))).toBe(false);
});

test('31 reminder days on the card page show the field error and keep the saved value (AC-03, sad path)', async ({
  page,
}) => {
  await signedInUser(page, 'card-reminder-invalid');
  const cardId = await createCard(page, 'Visa', '7');

  const field = page.getByLabel(t.detail.reminderDays, { exact: true });
  await expect(field).toHaveValue('7');
  await field.fill('31');
  await page.getByRole('button', { name: t.detail.saveDays }).click();
  await expect(page.getByText(t.errors.reminderDaysInvalid)).toBeVisible();

  await page.goto(`/es/cards/${cardId}`);
  await expect(page.getByLabel(t.detail.reminderDays, { exact: true })).toHaveValue('7');
});

test('smoke: deleting a card with a due statement keeps the notices of other cards; the real AC-09 proof is statement-reminder-job.test.ts', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-reminder-deleted');
  // Smoke check only: a deletable card never owes a total, so it could not have a notice anyway.
  // The AC-09 proof (an owing card removed from the source creates nothing) is the job test.
  // A card with purchases or movements cannot be deleted (CARD_HAS_MOVEMENTS), so the deletable
  // card has a statement due soon and no total. The control card has a due statement with a total
  // and keeps its notice: it proves the worker ran passes after the deletion.
  const controlId = await createCard(page, 'Control', '7');
  await buyInInstallments(page, controlId, '60.000,00', '3');
  await makeFirstStatementDueSoon(email, 'Control');
  const cardId = await createCard(page, 'Visa', '7');
  await page.goto(`/es/cards/${cardId}`);
  const deleteButton = page.getByRole('button', { name: t.detail.delete });
  await expect(deleteButton).toBeVisible();

  // The deletion follows the helper at once; a pass that slips in between keeps its notice, so the
  // check is that the count stops growing, not that it is zero.
  await makeFirstStatementDueSoon(email, 'Visa');
  await deleteButton.click();
  await page.getByRole('button', { name: t.detail.confirm, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/cards$/);
  const before = (await waitForNotice(email, 'Control')).length;

  await page.waitForTimeout(TWO_PASSES_MS);
  const notices = await cardStatementNotices(email);
  expect(notices).toHaveLength(before);
  expect(notices.some((notice) => notice.text.includes('Visa'))).toBe(false);
  expect(notices.filter((notice) => notice.text.includes('Control'))).toHaveLength(1);
});
