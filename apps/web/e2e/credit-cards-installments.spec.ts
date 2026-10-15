import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  firstOpenPeriod,
  formatMoney,
  nextPeriod,
  statementDatesFor,
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

/** A statement date as the preview and the card detail format it: a calendar date, no zone. */
const formatDate = (date: string) =>
  new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** Today in the zone the app defaults to, and the statement of the card (closing 24, due 5) that is open. */
function openCycle() {
  const today = todayInTimeZone(new Date(), 'America/Argentina/Buenos_Aires');
  return { today, period: firstOpenPeriod(today, 24) };
}

/** What the schedule shows for payment `index` (0-based) of a purchase that starts in `period`. */
function expectedPayment(period: string, index: number) {
  let current = period;
  for (let step = 0; step < index; step += 1) current = nextPeriod(current);
  return { period: current, ...statementDatesFor(current, 24, 5) };
}

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
  const { today, period } = openCycle();
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill('120.000,00');
  await page.getByLabel(t.installments.fields.installments, { exact: true }).fill('12');
  await page.getByLabel(t.installments.fields.purchasedOn, { exact: true }).fill(today);

  // Before saving, the form shows each payment with its statement and dates (AC-02).
  const schedule = page.getByRole('region', { name: t.installments.preview.title });
  await expect(schedule.getByRole('row')).toHaveCount(13);
  const first = expectedPayment(period, 0);
  const last = expectedPayment(period, 11);
  for (const [row, payment, number] of [
    [schedule.getByRole('row').nth(1), first, '1'],
    [schedule.getByRole('row').nth(12), last, '12'],
  ] as const) {
    await expect(row.getByRole('cell').nth(0)).toHaveText(number);
    await expect(row.getByRole('cell').nth(1)).toHaveText(EACH);
    await expect(row.getByRole('cell').nth(2)).toContainText(formatMonth(payment.period));
    await expect(row.getByRole('cell').nth(3)).toHaveText(formatDate(payment.closingDate));
    await expect(row.getByRole('cell').nth(4)).toHaveText(formatDate(payment.dueDate));
  }
  await expect(
    page.getByText(
      t.installments.preview.closingDayNote.replace('{date}', formatDate(first.closingDate)),
    ),
  ).toBeVisible();

  await page
    .getByLabel(t.installments.fields.category, { exact: true })
    .selectOption({ label: EXPENSE_CATEGORY });
  await page.getByRole('button', { name: t.installments.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/cards/${cardId}$`));

  // The saved purchase lands on the statement and dates the preview announced.
  await expect(openStatement(page)).toContainText(
    t.detail.closes.replace('{date}', formatDate(first.closingDate)),
  );
  await expect(openStatement(page)).toContainText(
    t.detail.due.replace('{date}', formatDate(first.dueDate)),
  );

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

test('shows 60 payments within 100 ms of the last keystroke with the CPU throttled 4x (AC-01)', async ({
  page,
}) => {
  await signedInUser(page, 'installments-perf');
  const cardId = await createVisa(page);
  await page.goto(`/es/cards/${cardId}/installments/new`);
  await page.getByLabel(t.installments.fields.amount, { exact: true }).fill('600.000,00');
  const field = page.getByLabel(t.installments.fields.installments, { exact: true });
  await expect(field).toBeVisible();

  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    // In the page: from each input event of the field to the DOM commit that follows it, count the
    // rows. A MutationObserver callback runs right after React commits, so the time is the render
    // itself and leaves out the wait for the next paint.
    await page.evaluate(() => {
      const samples: { rows: number; ms: number }[] = [];
      (window as unknown as { __samples: typeof samples }).__samples = samples;
      let start: number | undefined;
      new MutationObserver(() => {
        if (start === undefined) return;
        samples.push({
          rows: document.querySelectorAll('[data-slot="installment-schedule-preview"] tbody tr')
            .length,
          ms: performance.now() - start,
        });
        start = undefined;
      }).observe(document.body, { childList: true, subtree: true });
      document.querySelector('input[name="installments"]')?.addEventListener(
        'input',
        () => {
          start = performance.now();
        },
        true,
      );
    });
    await field.click();
    await page.keyboard.type('60');
    const region = page.getByRole('region', { name: t.installments.preview.title });
    await expect(region.getByRole('row')).toHaveCount(61);
    // Re-edit the count between 59 and 60 so the budget is judged on the median of several renders:
    // one slow render on a busy machine is not a regression.
    for (const count of ['59', '60', '59', '60', '59', '60']) {
      await field.fill(count);
      await expect(region.getByRole('row')).toHaveCount(Number(count) + 1);
    }
    const readSamples = () =>
      page.evaluate(
        () => (window as unknown as { __samples: { rows: number; ms: number }[] }).__samples,
      );
    // Each keystroke or fill records a sample when the render that follows it is committed.
    await expect.poll(async () => (await readSamples()).length).toBeGreaterThanOrEqual(8);
    const full = (await readSamples()).filter((sample) => sample.rows >= 59);
    const times = full.map((sample) => sample.ms).sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY;
    test.info().annotations.push({
      type: 'render-ms',
      description: `throttled 4x, 59-60 rows, median ${median.toFixed(1)} ms of ${times.length}`,
    });

    expect(full.length).toBeGreaterThanOrEqual(7);
    expect(median).toBeLessThan(100);
  } finally {
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});
