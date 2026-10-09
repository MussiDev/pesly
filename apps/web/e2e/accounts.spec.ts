import { formatMoney } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const API_URL = 'http://localhost:4000';
const PASSWORD = 'correct horse battery staple';
const PRIVATE_ACCOUNT = 'Cuenta privada';

const es = catalogs.es;
const t = es.accounts;

/** What the screens print for an amount in minor units, from the same formatter the app uses. */
function money(minor: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en' = 'es'): string {
  return formatMoney(minor, currency, locale);
}

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

interface NewAccount {
  name: string;
  type: keyof typeof t.types;
  currency: 'ARS' | 'USD';
  /** Typed as is, in the es notation; left out to keep the pre-filled value. */
  openingBalance?: string;
}

async function fillAccountForm(page: Page, account: NewAccount): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(t.fields.name).fill(account.name);
  await page.getByLabel(t.fields.type).selectOption({ label: t.types[account.type] });
  await page.getByLabel(t.fields.currency).selectOption({ label: t.currencies[account.currency] });
  if (account.openingBalance !== undefined) {
    await page.getByLabel(t.fields.openingBalance).fill(account.openingBalance);
  }
  await page.getByRole('button', { name: t.form.submit }).click();
}

async function createAccount(page: Page, account: NewAccount): Promise<void> {
  await fillAccountForm(page, account);
  await expect(page).toHaveURL(/\/es\/accounts$/);
  await expect(row(page, account.name)).toBeVisible();
}

function row(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true });
}

function rowButton(page: Page, action: string, name: string) {
  return row(page, name).getByRole('button', { name: `${action} ${name}`, exact: true });
}

type Headline = 'available' | 'netWorth';

/** The headline figure of one currency: the <dd> that follows the Available / Net worth <dt>. */
function headline(page: Page, currency: 'ARS' | 'USD', which: Headline, catalog: typeof t = t) {
  return page
    .getByRole('group', { name: catalog.currencies[currency] })
    .locator('dt', { hasText: catalog.headline[which] })
    .locator('xpath=following-sibling::dd[1]');
}

/** The Debt section and its per-currency amount. */
function debtSection(page: Page, catalog: typeof t = t) {
  return page.getByRole('region', { name: catalog.debt.title });
}

function debtAmount(page: Page, currency: 'ARS' | 'USD', catalog: typeof t = t) {
  return debtSection(page, catalog)
    .locator('dt', { hasText: catalog.currencies[currency] })
    .locator('xpath=following-sibling::dd[1]');
}

// The flows must not trip over console errors or API failures that no test expects.
const consoleErrors: string[] = [];
let unexpectedStatuses: string[] = [];
let allowedStatuses: number[] = [];

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

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

test('an ARS and a USD account show their balances and the totals (AC-01, AC-11, AC-12)', async ({
  page,
}) => {
  await signedInUser(page, 'both-currencies');

  await createAccount(page, {
    name: 'Caja chica',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '1.500,00',
  });
  await createAccount(page, {
    name: 'Dólares ahorro',
    type: 'savings',
    currency: 'USD',
    openingBalance: '200,50',
  });

  await expect(row(page, 'Caja chica')).toContainText(money(150_000n, 'ARS'));
  await expect(row(page, 'Caja chica')).toContainText(t.types.cash);
  await expect(row(page, 'Dólares ahorro')).toContainText(money(20_050n, 'USD'));
  await expect(row(page, 'Dólares ahorro')).toContainText(t.types.savings);
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(150_000n, 'ARS'));
  await expect(headline(page, 'USD', 'netWorth')).toHaveText(money(20_050n, 'USD'));
});

test('the opening balance is optional (0) and a negative one is accepted (AC-16, AC-17)', async ({
  page,
}) => {
  await signedInUser(page, 'opening-balance');

  await page.goto('/es/accounts/new');
  await expect(page.getByLabel(t.fields.openingBalance)).toHaveValue('0');

  await createAccount(page, { name: 'En cero', type: 'bank_account', currency: 'ARS' });
  await createAccount(page, {
    name: 'Descubierto',
    type: 'bank_account',
    currency: 'ARS',
    openingBalance: '-250,50',
  });

  await expect(row(page, 'En cero')).toContainText(money(0n, 'ARS'));
  await expect(row(page, 'Descubierto')).toContainText(money(-25_050n, 'ARS'));
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(-25_050n, 'ARS'));
});

test('the form reports a missing name and offers the five account types (AC-02, AC-03)', async ({
  page,
}) => {
  await signedInUser(page, 'form-errors');
  await page.goto('/es/accounts/new');

  await expect(page.getByLabel(t.fields.type).locator('option')).toHaveText([
    t.fields.typePlaceholder,
    t.types.cash,
    t.types.bank_account,
    t.types.digital_wallet,
    t.types.credit_card,
    t.types.savings,
  ]);

  await page.getByRole('button', { name: t.form.submit }).click();

  await expect(page.getByText(t.errors.nameRequired)).toBeVisible();
  await expect(page.getByText(t.errors.typeRequired)).toBeVisible();
  await expect(page.getByText(t.errors.currencyRequired)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);
});

test('the form refuses an opening balance beyond the limit and creates nothing (AC-18, AC-19)', async ({
  page,
}) => {
  await signedInUser(page, 'beyond-limit');

  await fillAccountForm(page, {
    name: 'Demasiado',
    type: 'savings',
    currency: 'ARS',
    openingBalance: '10.000.000.000.000,01',
  });

  const message = t.errors.amountOutOfRange.replace('{max}', money(10n ** 15n, 'ARS'));
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByLabel(t.fields.openingBalance)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
  await expect(row(page, 'Demasiado')).toHaveCount(0);
});

test('the form refuses a name with only zero-width characters and creates nothing (AC-21)', async ({
  page,
}) => {
  await signedInUser(page, 'invisible-name');

  await fillAccountForm(page, { name: '\u200B\u200B', type: 'cash', currency: 'ARS' });

  await expect(page.getByText(t.errors.nameRequired)).toBeVisible();
  await expect(page.getByLabel(t.fields.name)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('the form refuses a name with a hidden character next to text (AC-20)', async ({ page }) => {
  await signedInUser(page, 'hidden-character');

  await fillAccountForm(page, { name: 'Caja\u200B', type: 'cash', currency: 'ARS' });

  await expect(page.getByText(t.errors.nameInvalidCharacters)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('rename, archive, unarchive and delete update the list (AC-06, AC-07, AC-08, AC-09)', async ({
  page,
}) => {
  await signedInUser(page, 'row-actions');
  await createAccount(page, {
    name: 'Billetera',
    type: 'digital_wallet',
    currency: 'ARS',
    openingBalance: '100,00',
  });

  await rowButton(page, t.actions.rename, 'Billetera').click();
  await page
    .getByLabel(t.actions.renameField.replace('{name}', 'Billetera'))
    .fill('Billetera nueva');
  await page.getByRole('button', { name: t.actions.save }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await expect(row(page, 'Billetera')).toHaveCount(0);

  await rowButton(page, t.actions.archive, 'Billetera nueva').click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.empty)).toBeVisible();
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(0n, 'ARS'));

  await page.getByRole('button', { name: t.list.showArchived }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await rowButton(page, t.actions.unarchive, 'Billetera nueva').click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.emptyArchived)).toBeVisible();

  await page.getByRole('button', { name: t.list.showActive }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(10_000n, 'ARS'));

  await rowButton(page, t.actions.delete, 'Billetera nueva').click();
  await expect(
    page.getByText(t.actions.confirmDelete.replace('{name}', 'Billetera nueva')),
  ).toBeVisible();
  await page.getByRole('button', { name: t.actions.confirmDeleteYes }).click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.empty)).toBeVisible();

  await page.reload();
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('editing the opening balance changes the balance and the headline (FEAT-006 AC-14, AC-15, AC-16, AC-19)', async ({
  page,
}) => {
  await signedInUser(page, 'opening-balance');
  await createAccount(page, {
    name: 'Billetera',
    type: 'digital_wallet',
    currency: 'ARS',
    openingBalance: '100,00',
  });

  await rowButton(page, t.actions.editOpeningBalance, 'Billetera').click();
  const field = page.getByLabel(t.openingEdit.field.replace('{name}', 'Billetera'));
  await expect(field).toHaveValue('100,00');
  await field.fill('250,50');
  await expect(
    page.getByText(t.openingEdit.preview.replace('{amount}', money(25_050n, 'ARS'))),
  ).toBeVisible();
  await page.getByRole('button', { name: t.actions.save }).click();

  await expect(page.getByLabel(t.openingEdit.field.replace('{name}', 'Billetera'))).toHaveCount(0);
  await expect(row(page, 'Billetera').getByText(money(25_050n, 'ARS'))).toBeVisible();
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(25_050n, 'ARS'));

  await page.reload();
  await expect(row(page, 'Billetera').getByText(money(25_050n, 'ARS'))).toBeVisible();
});

test('a duplicate name shows an error message (AC-13)', async ({ page }) => {
  await signedInUser(page, 'duplicate');
  await createAccount(page, { name: 'Sueldo', type: 'bank_account', currency: 'ARS' });
  allowedStatuses = [409];

  // Names are unique per owner regardless of case.
  await fillAccountForm(page, { name: 'sueldo', type: 'cash', currency: 'USD' });

  await expect(page.getByText(es.errors.accountNameTaken)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);
});

test("a second user never sees the first user's accounts (AC-15)", async ({ page, browser }) => {
  await signedInUser(page, 'owner');
  await createAccount(page, {
    name: PRIVATE_ACCOUNT,
    type: 'savings',
    currency: 'ARS',
    openingBalance: '999,00',
  });

  const other = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  try {
    const otherPage = await other.newPage();
    guard(otherPage);
    await signedInUser(otherPage, 'stranger');
    await otherPage.goto('/es/accounts');

    await expect(otherPage.getByText(t.list.empty)).toBeVisible();
    await expect(otherPage.getByText(PRIVATE_ACCOUNT)).toHaveCount(0);
    await expect(headline(otherPage, 'ARS', 'netWorth')).toHaveText(money(0n, 'ARS'));
  } finally {
    await other.close();
  }

  await page.goto('/es/accounts');
  await expect(row(page, PRIVATE_ACCOUNT)).toBeVisible();
});

/** Cash 1.000,00, savings 500,00 and a card owing 200,00, all in ARS: the FEAT-003 scenario. */
async function createHeadlineScenario(page: Page): Promise<void> {
  await createAccount(page, {
    name: 'Efectivo',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '1.000,00',
  });
  await createAccount(page, {
    name: 'Ahorro',
    type: 'savings',
    currency: 'ARS',
    openingBalance: '500,00',
  });
  await createAccount(page, {
    name: 'Visa',
    type: 'credit_card',
    currency: 'ARS',
    openingBalance: '-200,00',
  });
}

test('the headline shows Available and Net worth, cards sit under Debt and toggling savings moves only Available (AC-14, AC-16, AC-19, AC-07)', async ({
  page,
}) => {
  await signedInUser(page, 'headline');
  await createHeadlineScenario(page);

  // Available leaves out savings and the card by default; Net worth counts everything.
  await expect(headline(page, 'ARS', 'available')).toHaveText(money(100_000n, 'ARS'));
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(130_000n, 'ARS'));
  await expect(headline(page, 'USD', 'available')).toHaveText(money(0n, 'USD'));

  // The card appears only under Debt, with the card debt as its amount.
  await expect(debtSection(page)).toBeVisible();
  await expect(debtAmount(page, 'ARS')).toHaveText(money(-20_000n, 'ARS'));
  await expect(debtSection(page).getByRole('listitem', { name: 'Visa', exact: true })).toHaveCount(
    1,
  );
  await expect(debtSection(page).getByRole('listitem', { name: 'Efectivo' })).toHaveCount(0);
  await expect(debtSection(page).getByRole('listitem', { name: 'Ahorro' })).toHaveCount(0);
  await expect(row(page, 'Visa').getByRole('checkbox')).toHaveCount(0);
  await expect(row(page, 'Efectivo').getByRole('checkbox')).toBeChecked();
  await expect(row(page, 'Ahorro').getByRole('checkbox')).not.toBeChecked();

  // Including savings raises Available but leaves Net worth and Debt untouched.
  // The checkbox is controlled by the server answer, so click and then wait for the new state.
  await row(page, 'Ahorro').getByRole('checkbox').click();
  await expect(row(page, 'Ahorro').getByRole('checkbox')).toBeChecked();
  await expect(headline(page, 'ARS', 'available')).toHaveText(money(150_000n, 'ARS'));
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(130_000n, 'ARS'));
  await expect(debtAmount(page, 'ARS')).toHaveText(money(-20_000n, 'ARS'));

  await page.reload();
  await expect(row(page, 'Ahorro').getByRole('checkbox')).toBeChecked();
  await expect(headline(page, 'ARS', 'available')).toHaveText(money(150_000n, 'ARS'));
});

test('the archived view shows no setting checkbox and an unarchived account can change it again (AC-12, AC-13)', async ({
  page,
}) => {
  await signedInUser(page, 'archived-setting');
  await createAccount(page, {
    name: 'Ahorro',
    type: 'savings',
    currency: 'ARS',
    openingBalance: '500,00',
  });
  // The checkbox is controlled by the server answer, so click and then wait for the new state.
  await row(page, 'Ahorro').getByRole('checkbox').click();
  await expect(row(page, 'Ahorro').getByRole('checkbox')).toBeChecked();
  await expect(headline(page, 'ARS', 'available')).toHaveText(money(50_000n, 'ARS'));

  await rowButton(page, t.actions.archive, 'Ahorro').click();
  await expect(row(page, 'Ahorro')).toHaveCount(0);
  await page.getByRole('button', { name: t.list.showArchived }).click();
  await expect(row(page, 'Ahorro')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(t.fields.includeInAvailable)).toHaveCount(0);

  await rowButton(page, t.actions.unarchive, 'Ahorro').click();
  await expect(row(page, 'Ahorro')).toHaveCount(0);
  await page.getByRole('button', { name: t.list.showActive }).click();
  const setting = row(page, 'Ahorro').getByRole('checkbox');
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(headline(page, 'ARS', 'available')).toHaveText(money(0n, 'ARS'));
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(50_000n, 'ARS'));
});

test('the headline, Debt section and setting use the catalog labels in English and Spanish (AC-23)', async ({
  page,
}) => {
  const en = catalogs.en.accounts;

  await signedInUser(page, 'labels');
  await createHeadlineScenario(page);

  await expect(headline(page, 'ARS', 'available')).toHaveText(money(100_000n, 'ARS'));
  await expect(headline(page, 'ARS', 'netWorth')).toHaveText(money(130_000n, 'ARS'));
  await expect(debtSection(page)).toBeVisible();
  await expect(
    row(page, 'Efectivo').getByText(t.fields.includeInAvailable, { exact: true }),
  ).toBeVisible();

  await page.goto('/en/accounts');
  await expect(headline(page, 'ARS', 'available', en)).toHaveText(money(100_000n, 'ARS', 'en'));
  await expect(headline(page, 'ARS', 'netWorth', en)).toHaveText(money(130_000n, 'ARS', 'en'));
  await expect(debtSection(page, en)).toBeVisible();
  await expect(debtAmount(page, 'ARS', en)).toHaveText(money(-20_000n, 'ARS', 'en'));
  await expect(
    row(page, 'Efectivo').getByText(en.fields.includeInAvailable, { exact: true }),
  ).toBeVisible();
  await expect(debtSection(page)).toHaveCount(0);
});
