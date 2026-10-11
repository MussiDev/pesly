import { expect, test } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import {
  ars,
  createArsAccount,
  recordGroupExpense,
  scrollsHorizontally,
} from './support/group-expenses';
import { createGroup, createInvitationLink, signedInUser } from './support/groups';

const t = catalogs.es.groups;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('two users: record an expense with each split mode, read the list and the shares, set the default (AC-01, AC-04, AC-15)', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const contextB = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signedInUser(pageA, 'gexp-a', 'Ana Pérez');
    await signedInUser(pageB, 'gexp-b', 'Bruno Gómez');
    await createArsAccount(pageA, 'Cuenta de Ana');

    const groupId = await createGroup(pageA, 'Casa de playa');
    await pageB.goto(await createInvitationLink(pageA));
    await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}$`));

    // The detail page links to the new screens.
    await pageA.reload();
    await expect(pageA.getByRole('link', { name: t.detail.expensesLink })).toBeVisible();
    await expect(pageA.getByRole('link', { name: t.detail.defaultSplitLink })).toBeVisible();
    await pageA.getByRole('link', { name: t.detail.addExpenseLink }).click();
    await expect(pageA).toHaveURL(new RegExp(`/es/groups/${groupId}/expenses/new$`));

    await recordGroupExpense(pageA, {
      groupId,
      amount: '100,01',
      description: 'Cena en partes iguales',
      account: 'Cuenta de Ana',
      split: { mode: 'equal' },
    });
    await recordGroupExpense(pageA, {
      groupId,
      amount: '200,00',
      description: 'Alquiler por porcentajes',
      account: 'Cuenta de Ana',
      split: { mode: 'percentage', values: { 'Ana Pérez': '60', 'Bruno Gómez': '40' } },
    });
    await recordGroupExpense(pageA, {
      groupId,
      amount: '300,00',
      description: 'Super por montos exactos',
      account: 'Cuenta de Ana',
      split: { mode: 'exact', values: { 'Ana Pérez': '100,00', 'Bruno Gómez': '200,00' } },
    });

    // The list shows the caller's own share; the leftover cent of the equal split goes to the payer.
    const list = pageA.getByRole('list', { name: t.expenses.label });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list).toContainText('Cena en partes iguales');
    await expect(list).toContainText(t.expenses.yourShare.replace('{amount}', ars(5001n)));
    await expect(list).toContainText(t.expenses.yourShare.replace('{amount}', ars(12000n)));
    await expect(list).toContainText(t.expenses.yourShare.replace('{amount}', ars(10000n)));

    // B reads their own part on the shares page: 50,00 + 80,00 + 200,00.
    await pageB.goto('/es/groups');
    await pageB.getByRole('link', { name: t.list.sharesLink }).click();
    await expect(pageB).toHaveURL(/\/es\/groups\/shares$/);
    const shares = pageB.getByRole('list', { name: t.shares.listLabel });
    await expect(shares.getByRole('listitem')).toHaveCount(3);
    await expect(shares).toContainText(ars(5000n));
    await expect(shares).toContainText(ars(8000n));
    await expect(shares).toContainText(ars(20000n));

    // The admin sets the default; the member sees it read only.
    await pageA.goto(`/es/groups/${groupId}`);
    await pageA.getByRole('link', { name: t.detail.defaultSplitLink }).click();
    await pageA.getByLabel(t.defaultSplit.modeLabel, { exact: true }).selectOption('percentage');
    await pageA.getByLabel(t.defaultSplit.percentLabel.replace('{name}', 'Ana Pérez')).fill('70');
    await pageA.getByLabel(t.defaultSplit.percentLabel.replace('{name}', 'Bruno Gómez')).fill('30');
    await pageA.getByRole('button', { name: t.defaultSplit.save }).click();
    await expect(pageA.getByText(t.defaultSplit.saved)).toBeVisible();

    await pageB.goto(`/es/groups/${groupId}/default-split`);
    await expect(pageB.getByText(t.defaultSplit.readOnly)).toBeVisible();
    await expect(pageB.getByText('70%')).toBeVisible();
    await expect(pageB.getByRole('button', { name: t.defaultSplit.save })).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('a split the server refuses shows its message in the browser', async ({ page }) => {
  await signedInUser(page, 'gexp-refused');
  await createArsAccount(page, 'Cuenta de Ana');
  const groupId = await createGroup(page, 'Viaje');

  await page.route(/\/groups\/[^/]+\/expenses$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'GROUP_SPLIT_AMOUNT_MISMATCH', message: 'The shares do not add up.' },
      }),
    });
  });
  await page.goto(`/es/groups/${groupId}/expenses/new`);
  const form = t.expenses.form;
  await page.getByLabel(form.fields.amount, { exact: true }).fill('50,00');
  await page.getByLabel(form.fields.account, { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(form.fields.personalCategory, { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(form.fields.category, { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(form.fields.description, { exact: true }).fill('Rechazado');
  await page.getByRole('button', { name: form.submit }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/es/groups/${groupId}/expenses/new$`));
});

test('a user who is not in the group gets the not-found state on its expenses', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const contextB = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signedInUser(pageA, 'gexp-owner');
    await signedInUser(pageB, 'gexp-outsider');
    const groupId = await createGroup(pageA, 'Privado');

    await pageB.goto(`/es/groups/${groupId}/expenses`);
    await expect(pageB.getByText(t.detail.notFound.title)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('the list, form, default split and shares fit a 360 px viewport (NFR-01)', async ({
  page,
}) => {
  await signedInUser(page, 'gexp-narrow');
  await page.setViewportSize({ width: 360, height: 740 });
  await createArsAccount(page, 'Cuenta con un nombre bastante largo');
  const groupId = await createGroup(page, 'Viaje largo con un nombre bastante extenso ok');
  await recordGroupExpense(page, {
    groupId,
    amount: '1234567,89',
    description: 'Un gasto con una descripción bastante larga para el ancho',
    account: 'Cuenta con un nombre bastante largo',
    split: { mode: 'equal' },
  });

  for (const path of [
    `/es/groups/${groupId}`,
    `/es/groups/${groupId}/expenses`,
    `/es/groups/${groupId}/expenses/new`,
    `/es/groups/${groupId}/default-split`,
    '/es/groups/shares',
    '/es/groups',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await scrollsHorizontally(page), path).toBe(false);
  }
});
