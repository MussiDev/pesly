import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  formatMinorUnits,
  formatMoney,
} from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import {
  archiveAccount,
  automaticDebitRows,
  backdateDebitLinks,
  closeFirstStatement,
  movementsOf,
  resetAttemptLimits,
  type AutomaticDebitRow,
} from './support/database';

const es = catalogs.es;
const t = es.creditCards;
const accountsT = es.accounts;

test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });

// The first run compiles every page of a cold `next dev`, and a flow waits for worker passes.
test.setTimeout(180_000);

const CLAIM_TIMEOUT_MS = 60_000;
/** Two passes of the worker at the 5 s interval set in playwright.config.ts, plus a margin. */
const TWO_PASSES_MS = 12_000;

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

const ars = (minor: bigint) => formatMoney(minor, 'ARS', 'es');
const usd = (minor: bigint) => formatMoney(minor, 'USD', 'es');

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

async function createAccount(
  page: Page,
  name: string,
  currency: 'ARS' | 'USD',
  openingBalance: string,
): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsT.fields.name).fill(name);
  await page
    .getByLabel(accountsT.fields.type)
    .selectOption({ label: accountsT.types.bank_account });
  await page
    .getByLabel(accountsT.fields.currency)
    .selectOption({ label: accountsT.currencies[currency] });
  await page.getByLabel(accountsT.fields.openingBalance).fill(openingBalance);
  await page.getByRole('button', { name: accountsT.form.submit }).click();
  await expect(page.getByRole('listitem', { name, exact: true })).toBeVisible();
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

async function spend(
  page: Page,
  cardId: string,
  currency: 'ARS' | 'USD',
  amount: string,
): Promise<void> {
  await page.goto(`/es/cards/${cardId}/expense`);
  await page.getByLabel(t.expense.fields.currency, { exact: true }).selectOption(currency);
  await page.getByLabel(t.expense.fields.amount, { exact: true }).fill(amount);
  await page
    .getByLabel(t.expense.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.expense.submit }).click();
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

/** Links "Banco" as the ARS debit account from the card page and waits until it is saved. */
async function linkBankAsArsDebit(page: Page, cardId: string): Promise<void> {
  await page.goto(`/es/cards/${cardId}`);
  await page.getByLabel(t.detail.debitArs, { exact: true }).selectOption({ label: 'Banco' });
  await page.getByRole('button', { name: t.detail.debitSave }).click();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByLabel(t.detail.debitArs, { exact: true }).locator('option:checked'),
    ).toHaveText('Banco');
  }).toPass({ timeout: 15_000 });
}

/** Waits for the job to settle the claim of the card; fails naming the card if it never does. */
async function waitForClaim(
  email: string,
  predicate: (rows: AutomaticDebitRow[]) => boolean,
): Promise<AutomaticDebitRow[]> {
  await expect
    .poll(async () => predicate(await automaticDebitRows(email, 'Visa')), {
      message: `The worker never settled an automatic debit claim for the card "Visa" of ${email}`,
      timeout: CLAIM_TIMEOUT_MS,
      intervals: [1_000],
    })
    .toBe(true);
  return automaticDebitRows(email, 'Visa');
}

const paymentLine = (status: string, amount: bigint) =>
  t.detail.paymentLine
    .replace('{currency}', 'ARS')
    .replace('{status}', status)
    .replace('{amount}', ars(amount));

const closedStatement = (page: Page) =>
  page.getByRole('listitem').filter({ hasText: t.detail.closed });

const bankRow = (page: Page) => page.getByRole('listitem', { name: 'Banco', exact: true });

test('links the bank account, and after a worker pass the statement is paid in ARS and the balance dropped (AC-01, AC-03, AC-08)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-debit');
  await createAccount(page, 'Banco', 'ARS', '100.000,00');
  const cardId = await createVisa(page);
  await spend(page, cardId, 'ARS', '60.000,00');
  await closeFirstStatement(email, 'Visa');
  await linkBankAsArsDebit(page, cardId);
  await backdateDebitLinks(email, 'Visa');

  const rows = await waitForClaim(email, (found) => found.some((row) => row.status === 'recorded'));
  expect(rows).toEqual([
    expect.objectContaining({ currency: 'ARS', status: 'recorded', amount: '6000000' }),
  ]);

  await expect(async () => {
    await page.goto(`/es/cards/${cardId}`);
    await expect(closedStatement(page)).toContainText(
      paymentLine(t.detail.paymentStatus.paid, 6_000_000n),
    );
  }).toPass({ timeout: 15_000 });

  await page.goto('/es/accounts');
  await expect(bankRow(page)).toContainText(ars(4_000_000n));
});

test('debits only the remainder of a partially paid statement and a second pass adds no transfer (AC-09, AC-11)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-debit-partial');
  await createAccount(page, 'Banco', 'ARS', '100.000,00');
  const cardId = await createVisa(page);
  await spend(page, cardId, 'ARS', '60.000,00');
  await closeFirstStatement(email, 'Visa');
  // Paid before the link exists, so the worker cannot act on the statement in between.
  await payFromBank(page, cardId, '20.000,00');
  await linkBankAsArsDebit(page, cardId);
  await backdateDebitLinks(email, 'Visa');

  const rows = await waitForClaim(email, (found) => found.some((row) => row.status === 'recorded'));
  expect(rows).toEqual([
    expect.objectContaining({ currency: 'ARS', status: 'recorded', amount: '4000000' }),
  ]);

  // At least two more passes: the claim must keep the statement from being debited again.
  await page.waitForTimeout(TWO_PASSES_MS);
  const transfers = (await movementsOf(email)).filter((movement) => movement.type === 'transfer');
  expect(transfers.map((movement) => movement.amount)).toEqual(['2000000', '4000000']);
  expect(await automaticDebitRows(email, 'Visa')).toHaveLength(1);

  await page.goto(`/es/cards/${cardId}`);
  await expect(closedStatement(page)).toContainText(
    paymentLine(t.detail.paymentStatus.paid, 6_000_000n),
  );
  await page.goto('/es/accounts');
  await expect(bankRow(page)).toContainText(ars(4_000_000n));
});

test('an archived debit account leaves the statement unpaid and records no transfer (AC-07, sad path)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-debit-archived');
  await createAccount(page, 'Banco', 'ARS', '100.000,00');
  const cardId = await createVisa(page);
  await spend(page, cardId, 'ARS', '60.000,00');
  await closeFirstStatement(email, 'Visa');
  await linkBankAsArsDebit(page, cardId);
  await archiveAccount(email, 'Banco');
  await backdateDebitLinks(email, 'Visa');

  const rows = await waitForClaim(email, (found) => found.some((row) => row.status !== 'pending'));
  expect(rows).toEqual([
    expect.objectContaining({
      currency: 'ARS',
      status: 'skipped',
      reason: 'account_unavailable',
      amount: null,
    }),
  ]);

  await page.goto(`/es/cards/${cardId}`);
  await expect(closedStatement(page)).toContainText(paymentLine(t.detail.paymentStatus.unpaid, 0n));
  expect((await movementsOf(email)).filter((movement) => movement.type === 'transfer')).toEqual([]);
});

test('the ARS picker never lists a USD account or a card account, so a mismatch cannot be chosen (AC-02, sad path)', async ({
  page,
}) => {
  await signedInUser(page, 'card-debit-picker');
  await createAccount(page, 'Banco', 'ARS', '0,00');
  await createAccount(page, 'Ahorro dólares', 'USD', '0,00');
  const cardId = await createVisa(page);

  await page.goto(`/es/cards/${cardId}`);
  const arsPicker = page.getByLabel(t.detail.debitArs, { exact: true });
  const usdPicker = page.getByLabel(t.detail.debitUsd, { exact: true });
  await expect(arsPicker).toBeVisible();
  expect(await arsPicker.locator('option').allTextContents()).toEqual([
    t.detail.debitNone,
    'Banco',
  ]);
  expect(await usdPicker.locator('option').allTextContents()).toEqual([
    t.detail.debitNone,
    'Ahorro dólares',
  ]);
});

test('a card with no USD debit account records nothing in USD although it has a USD remainder (AC-04)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'card-debit-usd');
  await createAccount(page, 'Banco', 'ARS', '100.000,00');
  await createAccount(page, 'Ahorro dólares', 'USD', '500,00');
  const cardId = await createVisa(page);
  await spend(page, cardId, 'ARS', '60.000,00');
  await spend(page, cardId, 'USD', '15,99');
  await closeFirstStatement(email, 'Visa');
  await linkBankAsArsDebit(page, cardId);
  await backdateDebitLinks(email, 'Visa');

  await waitForClaim(email, (found) => found.some((row) => row.status === 'recorded'));
  // The USD claim would be created in the same pass as the ARS one; give the worker more passes.
  await page.waitForTimeout(TWO_PASSES_MS);

  const rows = await automaticDebitRows(email, 'Visa');
  expect(rows.map((row) => row.currency)).toEqual(['ARS']);
  const nonExpenses = (await movementsOf(email)).filter((movement) => movement.type !== 'expense');
  expect(nonExpenses.map((movement) => movement.type)).toEqual(['transfer']);

  await page.goto(`/es/cards/${cardId}`);
  await expect(closedStatement(page)).toContainText(
    t.detail.paymentLine
      .replace('{currency}', 'USD')
      .replace('{status}', t.detail.paymentStatus.unpaid)
      .replace('{amount}', `${formatMinorUnits(0n, 'es')}${String.fromCharCode(160)}USD`),
  );
  await page.goto('/es/accounts');
  await expect(page.getByRole('listitem', { name: 'Ahorro dólares', exact: true })).toContainText(
    usd(50_000n),
  );
});
