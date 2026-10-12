import { expect, test } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { ars, createArsAccount, scrollsHorizontally } from './support/group-expenses';
import { createGoal, entryForm, openGoal, submitEntry } from './support/goals';
import { signedInUser } from './support/groups';

const t = catalogs.es.goals;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('create, contribute, withdraw, read the history, edit and delete a goal (AC-12, AC-17, AC-20, AC-24)', async ({
  page,
}) => {
  await signedInUser(page, 'goals-flow');

  await page.goto('/es/goals');
  await expect(page.getByText(t.list.empty.title)).toBeVisible();

  await createGoal(page, { name: 'Viaje', target: '1000,00' });
  await expect(page.getByRole('listitem', { name: 'Viaje' })).toHaveCount(1);
  const goalId = await openGoal(page, 'Viaje');

  await submitEntry(page, 'contribution', '300,00');
  await expect(entryForm(page, 'contribution').getByText(t.entries.recorded)).toBeVisible();
  await submitEntry(page, 'withdrawal', '100,00');
  await expect(entryForm(page, 'withdrawal').getByText(t.entries.recorded)).toBeVisible();

  const history = page.getByRole('region', { name: t.detail.entries.title });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history).toContainText(t.detail.entries.contribution);
  await expect(history).toContainText(t.detail.entries.withdrawal);
  await expect(history).toContainText(ars(30000n));
  await expect(history).toContainText(ars(10000n));

  // A withdrawal larger than the progress is refused with the API's message (AC-26).
  await submitEntry(page, 'withdrawal', '5000,00');
  await expect(page.getByText(catalogs.es.errors.goalWithdrawalExceedsProgress)).toBeVisible();
  await expect(history.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('link', { name: t.detail.edit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/goals/${goalId}/edit$`));
  await page.getByLabel(t.form.name, { exact: true }).fill('Viaje a Bariloche');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page.getByRole('status')).toContainText(ars(20000n));

  await page.goto(`/es/goals/${goalId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Viaje a Bariloche' })).toBeVisible();

  await page.getByRole('button', { name: t.detail.delete }).click();
  await expect(page.getByText(t.delete.title)).toBeVisible();
  await page.getByRole('button', { name: t.delete.cancel }).click();
  await expect(page.getByText(t.delete.title)).toHaveCount(0);
  await page.getByRole('button', { name: t.detail.delete }).click();
  await page.getByRole('button', { name: t.delete.confirm }).click();
  await expect(page).toHaveURL(/\/es\/goals$/);
  await expect(page.getByText(t.list.empty.title)).toBeVisible();
});

test('a goal linked to an account has no entry forms and shows no raw id on edit', async ({
  page,
}) => {
  await signedInUser(page, 'goals-linked');
  await createArsAccount(page, 'Caja de ahorro');
  await createGoal(page, { name: 'Auto', target: '5000,00', account: 'Caja de ahorro' });
  const goalId = await openGoal(page, 'Auto');

  await expect(page.getByText(t.detail.linkedNotice)).toBeVisible();
  await expect(page.getByRole('button', { name: t.entries.submitContribution })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.entries.submitWithdrawal })).toHaveCount(0);

  await page.goto(`/es/goals/${goalId}/edit`);
  await expect(page.getByText(t.form.accountLinked)).toBeVisible();
  await expect(page.getByText(goalId)).toHaveCount(0);
});

test('a goal of another user and a malformed id open the not found state (AC-09)', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const contextB = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signedInUser(pageA, 'goals-owner');
    await signedInUser(pageB, 'goals-outsider');
    await createGoal(pageA, { name: 'Privada', target: '100,00' });
    const goalId = await openGoal(pageA, 'Privada');

    await pageB.goto(`/es/goals/${goalId}`);
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    await pageB.goto(`/es/goals/${goalId}/edit`);
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();

    let requests = 0;
    pageB.on('request', (request) => {
      if (/\/goals\/not-an-id/.test(request.url()) && !request.url().includes('/es/'))
        requests += 1;
    });
    await pageB.goto('/es/goals/not-an-id');
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    await pageB.goto('/es/goals/not-an-id/edit');
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
    expect(requests).toBe(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('the list, detail, create and edit screens fit a 360 px viewport (NFR-01)', async ({
  page,
}) => {
  await signedInUser(page, 'goals-narrow');
  await page.setViewportSize({ width: 360, height: 740 });
  await createGoal(page, {
    name: 'Una meta con un nombre bastante largo para el ancho',
    target: '1234567,89',
  });
  const goalId = await openGoal(page, 'Una meta con un nombre bastante largo para el ancho');
  await submitEntry(page, 'contribution', '1234,56');
  await expect(entryForm(page, 'contribution').getByText(t.entries.recorded)).toBeVisible();

  for (const path of [
    '/es/goals',
    `/es/goals/${goalId}`,
    '/es/goals/new',
    `/es/goals/${goalId}/edit`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await scrollsHorizontally(page), path).toBe(false);
  }
});
