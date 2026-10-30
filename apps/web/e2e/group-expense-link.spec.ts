import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { groupFacts, sharedGroup, type GroupFacts } from './support/group-settlements';
import { signedInUser } from './support/groups';
import {
  accountBalance,
  api,
  createExpenseMovement,
  expectNoHorizontalScroll,
  groupExpenses,
  senderSetup,
} from './support/movement-to-group';
import { openRows, openRowsUntil } from './support/rows';

const t = catalogs.es.groups;
const link = t.expenses.link;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

/** Bruno records an expense that Ana paid, so no movement is written for her. */
async function paidByAna(
  bruno: Page,
  groupId: string,
  anaFacts: GroupFacts,
  brunoFacts: GroupFacts,
  fields: { description: string; amount: string },
): Promise<void> {
  await api(bruno, 'POST', `/groups/${groupId}/expenses`, {
    amount: fields.amount,
    currency: 'ARS',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    payerMemberId: anaFacts.selfMemberId,
    categoryId: brunoFacts.categoryId,
    description: fields.description,
    split: { mode: 'equal', memberIds: [anaFacts.selfMemberId, brunoFacts.selfMemberId] },
  });
}

test('the payer links an expense that another member recorded, creating the movement or adopting one (FEAT-008 AC-02, AC-07, AC-11, AC-20, AC-23)', async ({
  browser,
}) => {
  const options = { locale: 'es-AR', timezoneId: 'America/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const ana = await contextA.newPage();
  const bruno = await contextB.newPage();
  try {
    await signedInUser(ana, 'link-a', 'Ana Pérez');
    await signedInUser(bruno, 'link-b', 'Bruno Gómez');
    const groupId = await sharedGroup(ana, bruno, 'Casa linkeada');
    const anaFacts = await groupFacts(ana, groupId);
    const brunoFacts = await groupFacts(bruno, groupId);
    await paidByAna(bruno, groupId, anaFacts, brunoFacts, {
      description: 'Cena creada',
      amount: '100000',
    });
    await paidByAna(bruno, groupId, anaFacts, brunoFacts, {
      description: 'Cena adoptada',
      amount: '200000',
    });
    const rowOf = (page: Page, text: string) =>
      page.getByRole('listitem').filter({ hasText: text });

    // Only the payer is offered the link (AC-20).
    await bruno.goto(`/es/groups/${groupId}/expenses`);
    await expect(rowOf(bruno, 'Cena creada')).toBeVisible();
    await openRows(bruno);
    await expect(bruno.getByRole('link', { name: t.expenses.linkAction })).toHaveCount(0);
    await ana.goto(`/es/groups/${groupId}/expenses`);
    await openRowsUntil(ana, async () => {
      await expect(ana.getByRole('link', { name: t.expenses.linkAction })).toHaveCount(2);
    });

    // Create the movement from an account and a category (AC-02, AC-07, AC-23).
    const before = await accountBalance(ana, anaFacts.payer.arsAccountId);
    await openRows(rowOf(ana, 'Cena creada'));
    await rowOf(ana, 'Cena creada').getByRole('link', { name: t.expenses.linkAction }).click();
    await expect(ana).toHaveURL(new RegExp(`/es/groups/${groupId}/expenses/[^/]+/link$`));
    await ana
      .getByLabel(t.expenses.form.fields.account)
      .selectOption({ value: anaFacts.payer.arsAccountId });
    await ana
      .getByLabel(t.expenses.form.fields.personalCategory)
      .selectOption({ value: anaFacts.payer.personalCategoryId });
    await ana.getByRole('button', { name: link.submit, exact: true }).click();
    await expect(ana).toHaveURL(new RegExp(`/es/groups/${groupId}/expenses$`));
    await expect(rowOf(ana, 'Cena creada').getByText(t.expenses.linkedMarker)).toBeVisible();
    expect(BigInt(await accountBalance(ana, anaFacts.payer.arsAccountId))).toBe(
      BigInt(before) - 100000n,
    );

    // Adopt a movement that was already registered: no new movement, no balance change (AC-11).
    const setup = await senderSetup(ana);
    await createExpenseMovement(ana, setup, '200000', 'Chango del súper');
    const cajaBefore = await accountBalance(ana, setup.accountId);
    await openRows(rowOf(ana, 'Cena adoptada'));
    await rowOf(ana, 'Cena adoptada').getByRole('link', { name: t.expenses.linkAction }).click();
    await ana.getByRole('radio', { name: link.ways.adopt }).click();
    await ana.getByRole('radio', { name: /Chango del súper/ }).click();
    await ana.getByRole('button', { name: link.submit, exact: true }).click();
    await expect(ana).toHaveURL(new RegExp(`/es/groups/${groupId}/expenses$`));
    await expect(rowOf(ana, 'Cena adoptada').getByText(t.expenses.linkedMarker)).toBeVisible();
    expect(await accountBalance(ana, setup.accountId)).toBe(cajaBefore);

    const expenses = await groupExpenses(ana, groupId);
    expect(expenses.filter((expense) => expense.payerMovementId !== null)).toHaveLength(2);

    // A linked expense no longer offers the link, and the screen answers for a direct visit.
    await openRows(ana);
    await expect(ana.getByRole('link', { name: t.expenses.linkAction })).toHaveCount(0);
    const linked = expenses.find((expense) => expense.description === 'Cena creada');
    await ana.goto(`/es/groups/${groupId}/expenses/${linked?.id ?? ''}/link`);
    await expect(ana.getByText(link.alreadyLinked)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('the link screen and the row fit 360 px and its controls are reachable by keyboard (FEAT-008 AC-32)', async ({
  browser,
}) => {
  const options = { locale: 'es-AR', timezoneId: 'America/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const ana = await contextA.newPage();
  const bruno = await contextB.newPage();
  try {
    await signedInUser(ana, 'link-narrow-a', 'Ana Pérez');
    await signedInUser(bruno, 'link-narrow-b', 'Bruno Gómez');
    const groupId = await sharedGroup(ana, bruno, 'Casa angosta');
    const anaFacts = await groupFacts(ana, groupId);
    const brunoFacts = await groupFacts(bruno, groupId);
    await paidByAna(bruno, groupId, anaFacts, brunoFacts, {
      description: 'Cena angosta',
      amount: '100000',
    });
    await ana.setViewportSize({ width: 360, height: 740 });

    await ana.goto(`/es/groups/${groupId}/expenses`);
    await openRowsUntil(ana, async () => {
      await expect(ana.getByRole('link', { name: t.expenses.linkAction })).toBeVisible();
    });
    await expectNoHorizontalScroll(ana);

    await ana.getByRole('link', { name: t.expenses.linkAction }).focus();
    await ana.keyboard.press('Enter');
    await expect(ana.getByRole('heading', { name: link.title })).toBeVisible();
    await ana.getByRole('radio', { name: link.ways.adopt }).focus();
    await ana.keyboard.press('Enter');
    await expect(ana.getByText(link.noCandidates)).toBeVisible();
    await expectNoHorizontalScroll(ana);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
