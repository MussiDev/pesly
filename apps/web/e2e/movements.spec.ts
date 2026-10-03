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
const WEB_URL = 'http://localhost:3000';

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

type Currency = 'ARS' | 'USD';

async function createNamedAccount(
  page: Page,
  name: string,
  currency: Currency,
  openingBalance: string,
): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(accountsCatalog.fields.name).fill(name);
  await page.getByLabel(accountsCatalog.fields.type).selectOption({
    label: accountsCatalog.types.cash,
  });
  await page.getByLabel(accountsCatalog.fields.currency).selectOption({
    label: accountsCatalog.currencies[currency],
  });
  await page.getByLabel(accountsCatalog.fields.openingBalance).fill(openingBalance);
  await page.getByRole('button', { name: accountsCatalog.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
  await expect(namedAccountRow(page, name)).toBeVisible();
}

function namedAccountRow(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true });
}

const CASH = 'Caja';
const BANK = 'Banco';
const DOLLARS = 'Dólares';
const label = (name: string, currency: Currency): string => `${name} (${currency})`;

/** Opens the entry screen on a transfer or an exchange with its source picked. */
async function openTwoAccountEntry(
  page: Page,
  type: 'transfer' | 'exchange',
  source: string,
): Promise<void> {
  await page.goto('/es/movements/new');
  await page.getByLabel(t.fields.type, { exact: true }).selectOption({ label: t.types[type] });
  await page.getByLabel(t.fields.account, { exact: true }).selectOption({ label: source });
}

function destinationPicker(page: Page) {
  return page.getByLabel(t.fields.destinationAccount, { exact: true });
}

async function destinationOptions(page: Page): Promise<string[]> {
  return destinationPicker(page).locator('option').allTextContents();
}

/** Today plus one day in the e2e user's zone (Cordoba, UTC-3 all year), as a datetime-local value. */
function tomorrowLocal(): string {
  return new Date(Date.now() + 24 * 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 16);
}

/** What the API's origin guard requires on a state-changing request. */
function apiHeaders(): Record<string, string> {
  return { Origin: WEB_URL, 'X-Requested-With': 'argent' };
}

async function accountIds(page: Page): Promise<Map<string, string>> {
  const response = await page.request.get(`${API_URL}/accounts?limit=100`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: { id: string; name: string }[] };
  return new Map(body.items.map((item) => [item.name, item.id]));
}

function idOf(ids: Map<string, string>, name: string): string {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`No account named ${name}`);
  return id;
}

const FIRST_OF_SEPTEMBER = '2026-09-01T10:00';
const SECOND_OF_SEPTEMBER = '2026-09-02T10:00';

test('records a transfer and a currency exchange, lists them newest first with the implied rate and moves the three balances (AC-01, AC-03, AC-05, AC-06, AC-08)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-two-accounts');
  await createNamedAccount(page, CASH, 'ARS', '1.000,00');
  await createNamedAccount(page, BANK, 'ARS', '10.000,00');
  await createNamedAccount(page, DOLLARS, 'USD', '100,00');

  // Transfer 200,00 from Caja to Banco. The picker offers only the other ARS account.
  await openTwoAccountEntry(page, 'transfer', label(CASH, 'ARS'));
  expect(await destinationOptions(page)).toEqual([
    t.fields.destinationAccountPlaceholder,
    label(BANK, 'ARS'),
  ]);
  await destinationPicker(page).selectOption({ label: label(BANK, 'ARS') });
  await page.getByLabel(t.fields.amount, { exact: true }).fill('200,00');
  await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(FIRST_OF_SEPTEMBER);
  await submit(page).click();
  await expect(page.getByRole('heading', { name: t.saved.title })).toBeVisible();
  // A transfer has no rate to show.
  await expect(page.getByRole('status')).toHaveCount(0);

  // Exchange 6.000,00 ARS from Banco for 5,00 USD in Dólares: 1.200,0000 ARS per USD.
  const impliedRate = formatRate(12_000_000n, 'es', 4);
  await openTwoAccountEntry(page, 'exchange', label(BANK, 'ARS'));
  expect(await destinationOptions(page)).toEqual([
    t.fields.destinationAccountPlaceholder,
    label(DOLLARS, 'USD'),
  ]);
  await destinationPicker(page).selectOption({ label: label(DOLLARS, 'USD') });
  await page.getByLabel(t.fields.amountOut, { exact: true }).fill('6.000,00');
  await page.getByLabel(t.fields.amountIn, { exact: true }).fill('5,00');
  await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(SECOND_OF_SEPTEMBER);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: t.exchange.impliedRate.replace('{rate}', impliedRate) }),
  ).toBeVisible();
  await submit(page).click();
  await expect(page.getByRole('heading', { name: t.saved.title })).toBeVisible();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: t.saved.impliedRate.replace('{rate}', impliedRate) }),
  ).toBeVisible();

  const stored = await movementsOf(email);
  expect(
    stored.map((movement) => [
      movement.type,
      movement.amount,
      movement.destinationAmount,
      movement.destinationAccountName,
      movement.rate,
      movement.rateSource,
    ]),
  ).toEqual([
    ['transfer', '20000', '20000', BANK, null, null],
    ['exchange', '600000', '500', DOLLARS, '12000000', 'implied'],
  ]);

  // Newest first: the exchange (2 Sep) before the transfer (1 Sep).
  await page.goto('/es/movements');
  const rows = page.getByRole('listitem').filter({ hasText: BANK });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(t.list.exchangeTitle);
  await expect(rows.nth(0)).toContainText(money(-600_000n));
  await expect(rows.nth(0)).toContainText(`+${formatMoney(500n, 'USD', 'es')}`);
  await expect(rows.nth(0)).toContainText(DOLLARS);
  await expect(rows.nth(0)).toContainText(t.list.rate.replace('{rate}', impliedRate));
  await expect(rows.nth(1)).toContainText(t.list.transferTitle);
  await expect(rows.nth(1)).toContainText(money(-20_000n));
  await expect(rows.nth(1)).toContainText(CASH);

  // 1.000,00 - 200,00; 10.000,00 + 200,00 - 6.000,00; 100,00 + 5,00.
  await page.goto('/es/accounts');
  await expect(namedAccountRow(page, CASH)).toContainText(money(80_000n));
  await expect(namedAccountRow(page, BANK)).toContainText(money(420_000n));
  await expect(namedAccountRow(page, DOLLARS)).toContainText(formatMoney(10_500n, 'USD', 'es'));
});

test('a transfer between currencies and an exchange between equal currencies cannot be picked, and the API refuses them with their codes (AC-02, AC-04)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-currency-rules');
  await createNamedAccount(page, CASH, 'ARS', '1.000,00');
  await createNamedAccount(page, BANK, 'ARS', '1.000,00');
  await createNamedAccount(page, DOLLARS, 'USD', '100,00');

  // The screen never offers a destination the rules would refuse.
  await openTwoAccountEntry(page, 'transfer', label(CASH, 'ARS'));
  expect(await destinationOptions(page)).not.toContain(label(DOLLARS, 'USD'));
  await openTwoAccountEntry(page, 'exchange', label(CASH, 'ARS'));
  expect(await destinationOptions(page)).not.toContain(label(BANK, 'ARS'));

  // Submitting without a destination names the field.
  await page.getByLabel(t.fields.amountOut, { exact: true }).fill('10,00');
  await page.getByLabel(t.fields.amountIn, { exact: true }).fill('1,00');
  await submit(page).click();
  await expect(page.getByText(t.errors.destinationRequired)).toBeVisible();

  // The server rules still hold for any other client.
  allowedStatuses = [400];
  const ids = await accountIds(page);
  const occurredAt = new Date(Date.now() - 3_600_000).toISOString();
  const mismatched = await page.request.post(`${API_URL}/movements`, {
    headers: apiHeaders(),
    data: {
      type: 'transfer',
      accountId: idOf(ids, CASH),
      destinationAccountId: idOf(ids, DOLLARS),
      amount: '1000',
      occurredAt,
    },
  });
  expect(mismatched.status()).toBe(400);
  expect(await mismatched.json()).toMatchObject({ code: 'MOVEMENT_CURRENCY_MISMATCH' });
  const sameCurrency = await page.request.post(`${API_URL}/movements`, {
    headers: apiHeaders(),
    data: {
      type: 'exchange',
      accountId: idOf(ids, CASH),
      destinationAccountId: idOf(ids, BANK),
      amount: '1000',
      destinationAmount: '1000',
      occurredAt,
    },
  });
  expect(sameCurrency.status()).toBe(400);
  expect(await sameCurrency.json()).toMatchObject({ code: 'EXCHANGE_SAME_CURRENCY' });

  expect(await movementsOf(email)).toEqual([]);
});

test('a zero amount and a date of tomorrow are refused on a transfer and on an exchange and save nothing (AC-07)', async ({
  page,
}) => {
  const email = await signedInUser(page, 'movements-two-accounts-invalid');
  await createNamedAccount(page, CASH, 'ARS', '1.000,00');
  await createNamedAccount(page, BANK, 'ARS', '1.000,00');
  await createNamedAccount(page, DOLLARS, 'USD', '100,00');

  await openTwoAccountEntry(page, 'transfer', label(CASH, 'ARS'));
  await destinationPicker(page).selectOption({ label: label(BANK, 'ARS') });
  await page.getByLabel(t.fields.amount, { exact: true }).fill('0');
  await submit(page).click();
  await expect(page.getByText(t.errors.amountNotPositive)).toBeVisible();

  await page.getByLabel(t.fields.amount, { exact: true }).fill('10,00');
  await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(tomorrowLocal());
  await submit(page).click();
  await expect(page.getByText(es.errors.movementDateInFuture)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/movements\/new$/);

  await openTwoAccountEntry(page, 'exchange', label(BANK, 'ARS'));
  await destinationPicker(page).selectOption({ label: label(DOLLARS, 'USD') });
  await page.getByLabel(t.fields.amountOut, { exact: true }).fill('1.000,00');
  await page.getByLabel(t.fields.amountIn, { exact: true }).fill('1,00');
  await page.getByLabel(t.fields.occurredAt, { exact: true }).fill(tomorrowLocal());
  await submit(page).click();
  await expect(page.getByText(es.errors.movementDateInFuture)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/movements\/new$/);

  expect(await movementsOf(email)).toEqual([]);
});

test('an account of another user sent by API on a transfer answers 404 and the balances do not change (AC-09)', async ({
  page,
  browser,
}) => {
  const email = await signedInUser(page, 'movements-owner');
  await createNamedAccount(page, CASH, 'ARS', '1.000,00');
  await createNamedAccount(page, BANK, 'ARS', '500,00');

  const otherContext = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const other = await otherContext.newPage();
  guard(other);
  let foreignId: string;
  try {
    await signedInUser(other, 'movements-stranger');
    await createNamedAccount(other, 'Ajena', 'ARS', '300,00');
    foreignId = idOf(await accountIds(other), 'Ajena');
  } finally {
    await otherContext.close();
  }

  allowedStatuses = [404];
  const ids = await accountIds(page);
  const occurredAt = new Date(Date.now() - 3_600_000).toISOString();
  const intoForeign = await page.request.post(`${API_URL}/movements`, {
    headers: apiHeaders(),
    data: {
      type: 'transfer',
      accountId: idOf(ids, CASH),
      destinationAccountId: foreignId,
      amount: '1000',
      occurredAt,
    },
  });
  expect(intoForeign.status()).toBe(404);
  const fromForeign = await page.request.post(`${API_URL}/movements`, {
    headers: apiHeaders(),
    data: {
      type: 'transfer',
      accountId: foreignId,
      destinationAccountId: idOf(ids, BANK),
      amount: '1000',
      occurredAt,
    },
  });
  expect(fromForeign.status()).toBe(404);

  expect(await movementsOf(email)).toEqual([]);
  await page.goto('/es/accounts');
  await expect(namedAccountRow(page, CASH)).toContainText(money(100_000n));
  await expect(namedAccountRow(page, BANK)).toContainText(money(50_000n));
});
