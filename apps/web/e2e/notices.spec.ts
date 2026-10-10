import { DEFAULT_CATEGORIES, defaultCategoryName, todayInTimeZone } from '@pesly/shared';
import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits, withE2eDatabase } from './support/database';

const en = catalogs.en;
const t = en.recurring;
const tNotices = en.notices;

test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'en');
})();

const NOTICE_TEXT = 'Rent is due in 5 days';

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('saves the reminder days of a recurring payment, shows the unread badge for its notice and marks it read on tap (DISC-001-08c)', async ({
  page,
}) => {
  const email = uniqueEmail('notices');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);

  await page.goto('/en/accounts/new');
  await page.getByLabel(en.accounts.fields.name).fill('Galicia');
  await page
    .getByLabel(en.accounts.fields.type)
    .selectOption({ label: en.accounts.types.bank_account });
  await page
    .getByLabel(en.accounts.fields.currency)
    .selectOption({ label: en.accounts.currencies.ARS });
  await page.getByRole('button', { name: en.accounts.form.submit }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);

  const today = todayInTimeZone(new Date(), 'America/Argentina/Buenos_Aires');
  const dayOfMonth = today.slice(8).replace(/^0/, '');

  await page.goto('/en/recurring/new');
  // The new field starts at the default of 3 days.
  const reminderDays = page.getByLabel(t.fields.reminderDays);
  await expect(reminderDays).toHaveValue('3');
  await page.getByLabel(t.fields.name).fill('Rent');
  await page.getByLabel(t.fields.amount, { exact: true }).fill('350000.00');
  await page.getByLabel(t.fields.account).selectOption({ label: 'Galicia (ARS)' });
  await page.getByLabel(t.fields.category).selectOption({ label: EXPENSE_CATEGORY });
  await page.getByLabel(t.frequency.label).selectOption('monthly');
  await page.getByLabel(t.fields.dayOfMonth).fill(dayOfMonth);
  await page.getByLabel(t.fields.startDate).fill(today);
  await page.getByLabel(t.mode.label).selectOption({ label: t.mode.confirmation });
  await reminderDays.fill('5');
  await page.getByRole('button', { name: t.actions.create }).click();
  await expect(page).toHaveURL(/\/en\/recurring$/);

  // Reopening the payment shows the value that was saved.
  await page.getByRole('link', { name: /Rent/ }).first().click();
  await expect(page).toHaveURL(/\/en\/recurring\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: t.actions.edit }).click();
  await expect(page.getByLabel(t.fields.reminderDays)).toHaveValue('5');

  const paymentId = /\/recurring\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (paymentId === undefined) throw new Error('The payment id is not in the URL');

  // The worker is not run here: the reminder it would write is seeded directly.
  await withE2eDatabase((client) =>
    client.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text)
       select id, 'reminder', $2::uuid, $3::date, $4 from users where email = $1`,
      [email, paymentId, today, NOTICE_TEXT],
    ),
  );

  await page.goto('/en');
  const link = page.getByRole('link', { name: tNotices.linkLabel.replace('{count}', '1') });
  await expect(link.first()).toBeVisible();
  await expect(link.first()).toContainText('1');

  await link.first().click();
  await expect(page).toHaveURL(/\/en\/notices$/);
  const notice = page.getByRole('button', { name: new RegExp(NOTICE_TEXT) });
  await expect(notice).toBeVisible();
  await notice.click();

  // Read: the row is no longer a button and the badge is gone.
  await expect(page.getByRole('button', { name: new RegExp(NOTICE_TEXT) })).toHaveCount(0);
  await expect(page.getByText(NOTICE_TEXT)).toBeVisible();
  await expect(page.getByRole('link', { name: /Notices, \d+ unread/ })).toHaveCount(0);
});
