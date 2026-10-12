import { expect, test } from '@playwright/test';
import {
  backdateBudgets,
  createBudget,
  EXPENSE_CATEGORIES,
  fillBudgetForm,
  openBudget,
  saveBudgetForm,
  seedBudgetAlertNotice,
  seedBudgets,
  signedInEmail,
} from './support/budgets';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { ars, scrollsHorizontally } from './support/group-expenses';
import { signedInUser } from './support/groups';

const t = catalogs.es.budgets;
const [FOOD, OUTINGS] = EXPENSE_CATEGORIES;
if (FOOD === undefined || OUTINGS === undefined) throw new Error('Not enough default categories');

test.use({ locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('create, read, edit, open the detail, add one with rollover and delete a budget (AC-15, AC-21, AC-24)', async ({
  page,
}) => {
  await signedInEmail(page, 'budgets-flow');

  await page.goto('/es/budgets');
  await expect(page.getByText(t.list.empty.title)).toBeVisible();

  await createBudget(page, { name: 'Comidas', amount: '50000,00', categories: [FOOD] });
  const card = page.getByRole('listitem', { name: 'Comidas' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(ars(5000000n));

  const budgetId = await openBudget(page, 'Comidas');
  await expect(page.getByRole('list', { name: t.detail.categories, exact: true })).toContainText(
    FOOD,
  );
  await expect(
    page.getByRole('list', { name: t.detail.thresholds, exact: true }).getByRole('listitem'),
  ).toHaveCount(2);

  await page.getByRole('link', { name: t.detail.edit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/budgets/${budgetId}/edit$`));
  // Nothing changed yet, so there is nothing to save.
  await expect(page.getByRole('button', { name: t.form.submit })).toBeDisabled();
  await page.getByLabel(t.form.name, { exact: true }).fill('Supermercado');
  await page.getByLabel(t.form.amount, { exact: true }).fill('75000,00');
  await page
    .getByRole('button', { name: t.form.thresholds.remove.replace('{percent}', '100') })
    .click();
  await page.getByLabel(t.form.thresholds.input, { exact: true }).fill('90');
  await page.getByRole('button', { name: t.form.thresholds.add }).click();
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Supermercado' })).toContainText(
    ars(7500000n),
  );

  await page.goto(`/es/budgets/${budgetId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Supermercado' })).toBeVisible();
  const thresholds = page.getByRole('list', { name: t.detail.thresholds, exact: true });
  await expect(thresholds.getByRole('listitem')).toHaveCount(2);
  await expect(thresholds).toContainText('90');
  await expect(thresholds).not.toContainText('100');

  await createBudget(page, {
    name: 'Salidas',
    amount: '20000,00',
    categories: [OUTINGS],
    rollover: true,
  });
  await expect(page.getByRole('listitem', { name: /Supermercado|Salidas/ })).toHaveCount(2);
  await openBudget(page, 'Salidas');
  await expect(page.getByText(/acumulados del mes anterior/)).toBeVisible();

  await page.getByRole('button', { name: t.detail.delete }).click();
  await expect(page.getByText(t.delete.title)).toBeVisible();
  await page.getByRole('button', { name: t.delete.cancel }).click();
  await expect(page.getByText(t.delete.title)).toHaveCount(0);
  await page.getByRole('button', { name: t.detail.delete }).click();
  await page.getByRole('button', { name: t.delete.confirm }).click();
  await expect(page).toHaveURL(/\/es\/budgets$/);
  await expect(page.getByRole('listitem', { name: 'Supermercado' })).toHaveCount(1);
  await expect(page.getByRole('listitem', { name: 'Salidas' })).toHaveCount(0);
});

test('an earlier month shows its budgets and the current month has no next action (AC-07, AC-08)', async ({
  page,
}) => {
  const email = await signedInEmail(page, 'budgets-months');
  await createBudget(page, { name: 'Comidas', amount: '50000,00', categories: [FOOD] });
  await backdateBudgets(email, 2);

  await page.goto('/es/budgets');
  await expect(page.getByRole('listitem', { name: 'Comidas' })).toBeVisible();
  await expect(page.getByText(t.list.month.current)).toBeVisible();
  await expect(page.getByRole('button', { name: t.list.month.next })).toHaveCount(0);

  await page.getByRole('button', { name: t.list.month.previous }).click();
  await expect(page.getByRole('button', { name: t.list.month.next })).toBeVisible();
  await expect(page.getByText(t.list.month.current)).toHaveCount(0);
  await expect(page.getByRole('listitem', { name: 'Comidas' })).toBeVisible();

  await page.getByRole('button', { name: t.list.month.next }).click();
  await expect(page.getByText(t.list.month.current)).toBeVisible();
  await expect(page.getByRole('button', { name: t.list.month.next })).toHaveCount(0);
});

test('the 51st budget is refused, the message shows and the values stay (AC-27)', async ({
  page,
}) => {
  const email = await signedInEmail(page, 'budgets-limit');
  // The default categories exist once the form has loaded them; the seeded budgets reuse one.
  await page.goto('/es/budgets/new');
  await expect(page.getByLabel(FOOD, { exact: true })).toBeVisible();
  await seedBudgets(email, 50);

  await fillBudgetForm(page, { name: 'Una más', amount: '1000,00', categories: [FOOD] });
  await saveBudgetForm(page);

  await expect(page.getByText(catalogs.es.errors.budgetLimitReached)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/budgets\/new$/);
  await expect(page.getByLabel(t.form.name, { exact: true })).toHaveValue('Una más');
  await expect(page.getByLabel(FOOD, { exact: true })).toBeChecked();
});

test('a budget of another user and a malformed id open the not found state (AC-12)', async ({
  browser,
}) => {
  const options = { locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signedInUser(pageA, 'budgets-owner');
    await signedInUser(pageB, 'budgets-outsider');
    await createBudget(pageA, { name: 'Privado', amount: '100,00', categories: [FOOD] });
    const budgetId = await openBudget(pageA, 'Privado');

    await pageB.goto(`/es/budgets/${budgetId}`);
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    await pageB.goto(`/es/budgets/${budgetId}/edit`);
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();

    let requests = 0;
    pageB.on('request', (request) => {
      if (/\/budgets\/not-an-id/.test(request.url()) && !request.url().includes('/es/')) {
        requests += 1;
      }
    });
    await pageB.goto('/es/budgets/not-an-id');
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    await pageB.goto('/es/budgets/not-an-id/edit');
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    expect(requests).toBe(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('a budget alert in the notices list shows the month and no due label (AC-26)', async ({
  page,
}) => {
  const email = await signedInEmail(page, 'budgets-notice');
  await seedBudgetAlertNotice(email, '2026-03-01', 'Comidas llegó al 80 % del presupuesto');

  await page.goto('/es/notices');
  await expect(page.getByText('Comidas llegó al 80 % del presupuesto')).toBeVisible();
  await expect(page.getByText(/Alerta de presupuesto de .*2026/i)).toBeVisible();
  await expect(page.getByText(/Vence/)).toHaveCount(0);
});

test('the list, detail, create and edit screens fit a 360 px viewport (NFR-01)', async ({
  page,
}) => {
  await signedInEmail(page, 'budgets-narrow');
  await page.setViewportSize({ width: 360, height: 740 });
  const name = 'Un presupuesto con un nombre bastante largo';
  await createBudget(page, { name, amount: '1234567,89', categories: [FOOD, OUTINGS] });
  const budgetId = await openBudget(page, name);

  const screens = [
    { path: '/es/budgets', ready: page.getByRole('listitem', { name }) },
    { path: `/es/budgets/${budgetId}`, ready: page.getByRole('progressbar') },
    { path: '/es/budgets/new', ready: page.getByLabel(FOOD, { exact: true }) },
    { path: `/es/budgets/${budgetId}/edit`, ready: page.getByLabel(FOOD, { exact: true }) },
  ];
  for (const { path, ready } of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(ready).toBeVisible();
    expect(await scrollsHorizontally(page), path).toBe(false);
  }
});
