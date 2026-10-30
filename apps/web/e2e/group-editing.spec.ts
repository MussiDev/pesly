import { formatMinorUnits } from '@pesly/shared';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { ars } from './support/group-expenses';
import {
  blockGroupWrites,
  countApiRequests,
  createExpense,
  databaseNames,
  makeAdmin,
  requestPass,
  serverExpenses,
  serverSettlementIds,
} from './support/group-editing';
import {
  groupFacts,
  leaveGroup,
  memberIdByName,
  seedExpense,
  seedSettlement,
  sharedGroup,
  type GroupFacts,
} from './support/group-settlements';
import { scrollsHorizontally, signedInUser } from './support/groups';
import { openRows, openRowsUntil } from './support/rows';

const t = catalogs.es.groups;
const tEn = catalogs.en.groups;
const errors = catalogs.es.errors;
const common = t.edit.common;

const ANA = 'Ana Pérez';
const BRUNO = 'Bruno Gómez';
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

interface Pair {
  pageA: Page;
  pageB: Page;
  groupId: string;
  factsA: GroupFacts;
  factsB: GroupFacts;
  ana: string;
  bruno: string;
  close: () => Promise<void>;
}

/** Ana (the admin) and Bruno in one group, each with accounts; the caller closes the contexts. */
async function pairInGroup(browser: Browser, label: string, groupName: string): Promise<Pair> {
  const options = { locale: 'es-AR', timezoneId: 'America/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await signedInUser(pageA, `${label}-a`, ANA);
  await signedInUser(pageB, `${label}-b`, BRUNO);
  const groupId = await sharedGroup(pageA, pageB, groupName);
  const factsA = await groupFacts(pageA, groupId);
  const factsB = await groupFacts(pageB, groupId);
  return {
    pageA,
    pageB,
    groupId,
    factsA,
    factsB,
    ana: factsA.selfMemberId,
    bruno: memberIdByName(factsA, BRUNO),
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

const expensesUrl = (groupId: string) => `/es/groups/${groupId}/expenses`;
const expenseEditUrl = (groupId: string, id: string) => `${expensesUrl(groupId)}/${id}/edit`;
const settlementEditUrl = (groupId: string, id: string) =>
  `/es/groups/${groupId}/settlements/${id}/edit`;

/** The expense row whose text contains `text`; the actions and the marker live inside it. */
function expenseRow(page: Page, text: string) {
  return page
    .getByRole('list', { name: t.expenses.label })
    .getByRole('listitem')
    .filter({ hasText: text });
}

/** Types a new description and a new amount on the open expense edit screen and saves. */
async function saveExpenseEdit(
  page: Page,
  groupId: string,
  values: { description: string; amount?: string },
): Promise<void> {
  const form = t.expenses.form;
  if (values.amount !== undefined) {
    await page.getByLabel(form.fields.amount, { exact: true }).fill(values.amount);
  }
  await page.getByLabel(form.fields.description, { exact: true }).fill(values.description);
  await page.getByRole('button', { name: t.edit.expense.submit, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${expensesUrl(groupId)}$`));
}

test('the author edits and deletes; a plain member has no actions; the activity page shows the edit; the shell counts the wait (AC-03, AC-06 to AC-09, AC-14 to AC-16, AC-18, AC-22, AC-30, AC-33, AC-35, NFR-02)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-main', 'Casa de playa');
  const { pageA, pageB, groupId } = pair;
  try {
    const both = [pair.ana, pair.bruno];
    const cena = await createExpense(pageA, groupId, pair.factsA, {
      amount: '1000000',
      description: 'Cena',
      memberIds: both,
    });
    const taxi = await createExpense(pageB, groupId, pair.factsB, {
      amount: '200000',
      description: 'Taxi',
      memberIds: both,
    });
    await seedSettlement(pageA, groupId, pair.factsA, {
      toMemberId: pair.bruno,
      amount: '30000',
      currency: 'ARS',
    });

    // AC-15, AC-16: Bruno acts only on his own record and is told so at the other's address.
    await pageB.goto(expensesUrl(groupId));
    await expect(expenseRow(pageB, 'Cena')).toBeVisible();
    await openRowsUntil(expenseRow(pageB, 'Taxi'), async () => {
      await expect(
        expenseRow(pageB, 'Taxi').getByRole('link', { name: common.actions.edit }),
      ).toHaveCount(1);
    });
    await openRows(expenseRow(pageB, 'Cena'));
    await expect(
      expenseRow(pageB, 'Cena').getByRole('link', { name: common.actions.edit }),
    ).toHaveCount(0);
    await pageB.goto(expenseEditUrl(groupId, cena));
    await expect(pageB.getByText(t.edit.expense.notAllowed.title)).toBeVisible();
    await expect(pageB.getByLabel(t.expenses.form.fields.amount, { exact: true })).toHaveCount(0);

    // NFR-02: the edit screens and the activity page stay inside their budgets.
    const expenseScreen = countApiRequests(pageA, ['/groups/']);
    await pageA.goto(expenseEditUrl(groupId, cena));
    await expect(pageA.getByLabel(t.expenses.form.fields.amount, { exact: true })).toHaveValue(
      formatMinorUnits(1000000n, 'es'),
    );
    await expect(pageA.getByLabel(t.expenses.form.fields.description, { exact: true })).toHaveValue(
      'Cena',
    );
    expect(expenseScreen.stop().length).toBeLessThanOrEqual(3);

    // AC-03, AC-06, AC-07: the change waits, then applies and shows no marker.
    await pageA.goto(expenseEditUrl(groupId, cena));
    const lift = await blockGroupWrites(pageA);
    await saveExpenseEdit(pageA, groupId, { description: 'Cena grande', amount: '120,00' });
    const waiting = expenseRow(pageA, 'Cena grande');
    await expect(waiting).toContainText(ars(12000n));
    await expect(waiting).toContainText(common.sync.pending);
    // AC-22: the shell counts the wait and links to the groups list.
    const status = pageA.getByRole('status').getByRole('link', { name: /cambio de grupo/ });
    await expect(status).toHaveAttribute('href', '/es/groups');
    await lift();
    await expect(pageA.getByText(common.sync.pending)).toHaveCount(0);
    await expect(expenseRow(pageA, 'Cena grande')).toContainText(ars(12000n));
    await expect
      .poll(async () => (await serverExpenses(pageA, groupId)).map((item) => item.description))
      .toContain('Cena grande');
    expect((await serverExpenses(pageA, groupId)).find((item) => item.id === cena)?.amount).toBe(
      '12000',
    );

    // AC-30, AC-35: the activity page lists the edit with before and after values.
    const activity = countApiRequests(pageA, ['/groups/']);
    await pageA.goto(`/es/groups/${groupId}/activity`);
    const edit = pageA
      .getByRole('listitem')
      .filter({ hasText: t.activity.actions.expense_updated });
    await expect(edit.first()).toContainText(ANA);
    await expect(edit.first()).toContainText('Cena grande');
    await expect(edit.first()).toContainText(formatMinorUnits(1000000n, 'es'));
    await expect(edit.first()).toContainText(formatMinorUnits(12000n, 'es'));
    // The group, the first page, and at most one category lookup (D6).
    expect(
      activity.stop().filter((entry) => !entry.endsWith('/categories')).length,
    ).toBeLessThanOrEqual(2);

    // AC-09, AC-08: cancelling changes nothing, confirming removes the expense.
    await pageA.goto(expensesUrl(groupId));
    const row = expenseRow(pageA, 'Cena grande');
    await openRowsUntil(row, async () => {
      await expect(row.getByRole('button', { name: common.actions.delete })).toBeVisible();
    });
    await row.getByRole('button', { name: common.actions.delete }).click();
    await row.getByRole('button', { name: common.deleteConfirm.cancel }).click();
    await expect(row).toBeVisible();
    expect((await serverExpenses(pageA, groupId)).map((item) => item.id)).toContain(cena);
    await openRows(row);
    await row.getByRole('button', { name: common.actions.delete }).click();
    await row.getByRole('button', { name: common.deleteConfirm.confirm }).click();
    await expect(expenseRow(pageA, 'Cena grande')).toHaveCount(0);
    await expect
      .poll(async () => (await serverExpenses(pageA, groupId)).map((item) => item.id))
      .not.toContain(cena);

    // AC-14: the author deletes a settlement.
    await pageA.goto(`/es/groups/${groupId}/settlements`);
    const settlementRow = pageA.getByRole('main').getByRole('listitem').first();
    await settlementRow.getByRole('button', { name: common.actions.delete }).click();
    await settlementRow.getByRole('button', { name: common.deleteConfirm.confirm }).click();
    await expect.poll(() => serverSettlementIds(pageA, groupId)).toEqual([]);

    // AC-18: a record that does not exist, or an id that is not one, is not found.
    await pageA.goto(expenseEditUrl(groupId, ABSENT_ID));
    await expect(pageA.getByText(t.edit.expense.notFound.title)).toBeVisible();
    await pageA.goto(expenseEditUrl(groupId, 'not-an-id'));
    await expect(pageA.getByText(t.edit.expense.notFound.title)).toBeVisible();

    // AC-33, AC-18: someone who is not in the group learns nothing.
    const context = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
    try {
      const outsider = await context.newPage();
      await signedInUser(outsider, 'ge-main-c', 'Carla Díaz');
      await outsider.goto(expenseEditUrl(groupId, taxi));
      await expect(outsider.getByText(t.edit.expense.notFound.title)).toBeVisible();
      await outsider.goto(`/es/groups/${groupId}/activity`);
      await expect(outsider.getByText(t.detail.notFound.title)).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await pair.close();
  }
});

test('an admin edits a record that is not theirs; a consolidated payment offers only deletion in the history (AC-12, AC-14, AC-15)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-consolidated', 'Viaje largo');
  const { pageA, groupId } = pair;
  try {
    const taxi = await createExpense(pair.pageB, groupId, pair.factsB, {
      amount: '200000',
      description: 'Taxi',
      memberIds: [pair.ana, pair.bruno],
    });
    await pageA.goto(expenseEditUrl(groupId, taxi));
    await saveExpenseEdit(pageA, groupId, { description: 'Taxi al aeropuerto' });
    await expect(expenseRow(pageA, 'Taxi al aeropuerto')).toBeVisible();
    await expect
      .poll(async () => (await serverExpenses(pageA, groupId)).map((item) => item.description))
      .toContain('Taxi al aeropuerto');

    // Debts in both currencies, then the consolidation that records them as one payment.
    await seedExpense(pageA, groupId, pair.factsA, {
      amount: '1000000',
      currency: 'ARS',
      description: 'Cena',
    });
    await seedExpense(pair.pageB, groupId, pair.factsB, {
      amount: '10000',
      currency: 'USD',
      description: 'Hotel',
    });
    await pageA.goto(`/es/groups/${groupId}/settlements/consolidate`);
    await pageA.getByLabel(t.consolidate.fields.memberB, { exact: true }).selectOption(pair.bruno);
    await expect(pageA.getByLabel(t.consolidate.fields.rate, { exact: true })).not.toHaveValue('');
    await pageA.getByRole('button', { name: t.consolidate.record, exact: true }).click();
    await expect(pageA.getByText(t.consolidate.done.title)).toBeVisible();

    await pageA.goto(`/es/groups/${groupId}/settlements`);
    const consolidated = pageA
      .getByRole('listitem')
      .filter({ hasText: t.settlements.consolidated })
      .first();
    await expect(consolidated).toBeVisible();
    await expect(consolidated.getByRole('link', { name: common.actions.edit })).toHaveCount(0);
    await expect(consolidated.getByRole('button', { name: common.actions.delete })).toBeVisible();

    // AC-14: the consolidated payment can be deleted from the history.
    const [first] = await serverSettlementIds(pageA, groupId);
    if (first === undefined) throw new Error('The consolidation recorded nothing');
    await consolidated.getByRole('button', { name: common.actions.delete }).click();
    await consolidated.getByRole('button', { name: common.deleteConfirm.confirm }).click();
    await expect.poll(() => serverSettlementIds(pageA, groupId)).not.toContain(first);
  } finally {
    await pair.close();
  }
});

test('the settlement edit address loads, offers only deletion for a consolidated payment and stays inside 2 requests (AC-10 to AC-13, AC-18, NFR-02)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-settlement-edit', 'Viaje largo');
  const { pageA, groupId } = pair;
  try {
    await seedSettlement(pageA, groupId, pair.factsA, {
      toMemberId: pair.bruno,
      amount: '30000',
      currency: 'ARS',
    });
    const [settlementId] = await serverSettlementIds(pageA, groupId);
    if (settlementId === undefined) throw new Error('No settlement was seeded');
    const screen = countApiRequests(pageA, ['/groups/']);
    await pageA.goto(settlementEditUrl(groupId, settlementId));
    await expect(pageA.getByLabel(t.edit.settlement.fields.amount, { exact: true })).toHaveValue(
      formatMinorUnits(30000n, 'es'),
    );
    expect(screen.stop().length).toBeLessThanOrEqual(2);
    await pageA.goto(settlementEditUrl(groupId, ABSENT_ID));
    await expect(pageA.getByText(t.edit.settlement.notFound.title)).toBeVisible();
  } finally {
    await pair.close();
  }
});

test('a refusal after the pass shows its message on a failed row, keeps the values, offers only discard and fits 360 px (AC-17, AC-19, AC-22, AC-24, AC-25, NFR-01)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-former', 'Casa de playa');
  const { pageA, pageB, groupId } = pair;
  try {
    const cena = await createExpense(pageA, groupId, pair.factsA, {
      amount: '1000000',
      description: 'Cena',
      memberIds: [pair.ana, pair.bruno],
    });
    await pageA.goto(expenseEditUrl(groupId, cena));
    const lift = await blockGroupWrites(pageA);
    await saveExpenseEdit(pageA, groupId, { description: 'Cena editada', amount: '9000,00' });
    await expect(expenseRow(pageA, 'Cena editada')).toContainText(common.sync.pending);

    // Meanwhile Bruno pays his share and leaves: the record now involves a former member.
    await seedSettlement(pageB, groupId, pair.factsB, {
      toMemberId: pair.ana,
      amount: '500000',
      currency: 'ARS',
    });
    await leaveGroup(pageB, groupId);
    await lift();

    await pageA.setViewportSize({ width: 360, height: 740 });
    const failed = expenseRow(pageA, 'Cena editada');
    await expect(failed).toContainText(common.sync.failed);
    await expect(failed).toContainText(errors.groupRecordFormerMember);
    await expect(failed.getByRole('button', { name: common.actions.discard })).toBeVisible();
    await expect(failed.getByRole('button', { name: common.actions.retry })).toHaveCount(0);
    expect(await scrollsHorizontally(pageA)).toBe(false);
    // AC-22: the shell counts the refused change.
    await expect(
      pageA.getByRole('status').getByRole('link', { name: /cambio de grupo no se sincroniz/ }),
    ).toBeVisible();

    // AC-24, AC-25: discarding drops the change and the row shows the server's values again.
    await failed.getByRole('button', { name: common.actions.discard }).click();
    await expect(expenseRow(pageA, 'Cena editada')).toHaveCount(0);
    await expect(expenseRow(pageA, 'Cena')).toBeVisible();
    await expect(pageA.getByText(common.sync.failed)).toHaveCount(0);
    expect((await serverExpenses(pageA, groupId)).map((item) => item.description)).toContain(
      'Cena',
    );
  } finally {
    await pair.close();
  }
});

test('two members edit the same expense: the conflict shows both versions and resolves each way, at 360 px (AC-26 to AC-28, NFR-01, NFR-05)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-conflict', 'Casa de playa');
  const { pageA, pageB, groupId } = pair;
  try {
    await makeAdmin(pageA, groupId, pair.bruno);
    const both = [pair.ana, pair.bruno];
    const mine = await createExpense(pageA, groupId, pair.factsA, {
      amount: '100000',
      description: 'Super',
      memberIds: both,
    });
    const theirs = await createExpense(pageA, groupId, pair.factsA, {
      amount: '200000',
      description: 'Cine',
      memberIds: both,
    });

    // Ana edits both with the connection down: both stay on the device.
    const lift = await blockGroupWrites(pageA);
    for (const [id, description] of [
      [mine, 'Super de Ana'],
      [theirs, 'Cine de Ana'],
    ] as const) {
      await pageA.goto(expenseEditUrl(groupId, id));
      await expect(
        pageA.getByLabel(t.expenses.form.fields.description, { exact: true }),
      ).not.toHaveValue('');
      await saveExpenseEdit(pageA, groupId, { description });
      await expect(expenseRow(pageA, description)).toContainText(common.sync.pending);
    }

    // Bruno edits both on the server while Ana is cut off.
    for (const [id, description] of [
      [mine, 'Super de Bruno'],
      [theirs, 'Cine de Bruno'],
    ] as const) {
      await pageB.goto(expenseEditUrl(groupId, id));
      await expect(
        pageB.getByLabel(t.expenses.form.fields.description, { exact: true }),
      ).not.toHaveValue('');
      await saveExpenseEdit(pageB, groupId, { description });
      await expect(expenseRow(pageB, description)).toBeVisible();
    }
    await expect
      .poll(async () => (await serverExpenses(pageB, groupId)).map((e) => e.description))
      .toEqual(expect.arrayContaining(['Super de Bruno', 'Cine de Bruno']));
    await lift();

    await pageA.setViewportSize({ width: 360, height: 740 });
    await pageA.goto(expensesUrl(groupId));
    await expect(pageA.getByText(common.sync.conflict)).toHaveCount(2);
    expect(await scrollsHorizontally(pageA)).toBe(false);

    // Both versions side by side, the differing field marked, nothing lost yet (NFR-05).
    await pageA.goto(expenseEditUrl(groupId, mine));
    const conflict = catalogs.es.groupConflict;
    await expect(pageA.getByText(conflict.titleExpense)).toBeVisible();
    await expect(pageA.getByText('Super de Ana')).toBeVisible();
    await expect(pageA.getByText('Super de Bruno')).toBeVisible();
    await expect(pageA.getByText(conflict.differs).first()).toBeVisible();
    expect(await scrollsHorizontally(pageA)).toBe(false);
    expect((await serverExpenses(pageA, groupId)).find((e) => e.id === mine)?.description).toBe(
      'Super de Bruno',
    );

    // "Keep mine": Ana's version reaches the server.
    await pageA.getByRole('button', { name: conflict.keepMine }).click();
    await expect
      .poll(
        async () => (await serverExpenses(pageA, groupId)).find((e) => e.id === mine)?.description,
      )
      .toBe('Super de Ana');

    // "Keep server's": the server copy stays and the local change is dropped.
    await pageA.goto(expenseEditUrl(groupId, theirs));
    await pageA.getByRole('button', { name: conflict.keepServer }).click();
    await pageA.goto(expensesUrl(groupId));
    await expect(expenseRow(pageA, 'Cine de Bruno')).toHaveCount(1);
    await expect(expenseRow(pageA, 'Cine de Ana')).toHaveCount(0);
    expect((await serverExpenses(pageA, groupId)).find((e) => e.id === theirs)?.description).toBe(
      'Cine de Bruno',
    );
    await expect(pageA.getByText(common.sync.conflict)).toHaveCount(0);
    await expect(pageA.getByText(common.sync.pending)).toHaveCount(0);
  } finally {
    await pair.close();
  }
});

test('the activity page pages with load more, names a former member, is linked from the detail and renders in English at 360 px (AC-31, AC-32, AC-34, AC-37, NFR-01)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-activity', 'Casa de playa');
  const { pageA, pageB, groupId } = pair;
  try {
    // Bruno records one expense for himself alone, so he can leave with a zero balance.
    await createExpense(pageB, groupId, pair.factsB, {
      amount: '10000',
      description: 'Café de Bruno',
      memberIds: [pair.bruno],
    });
    for (let index = 0; index < 50; index += 1) {
      await createExpense(pageA, groupId, pair.factsA, {
        amount: '10000',
        description: `Gasto ${index}`,
        memberIds: [pair.ana],
      });
    }
    await leaveGroup(pageB, groupId);

    await pageA.setViewportSize({ width: 360, height: 740 });
    await pageA.goto(`/es/groups/${groupId}`);
    await pageA.getByRole('link', { name: t.detail.activityLink }).click();
    await expect(pageA).toHaveURL(new RegExp(`/es/groups/${groupId}/activity$`));
    const entries = pageA
      .getByRole('listitem')
      .filter({ hasText: t.activity.actions.expense_created });
    await expect(entries).toHaveCount(50);
    await pageA.getByRole('button', { name: t.activity.loadMore }).click();
    await expect(entries).toHaveCount(51);
    await expect(pageA.getByRole('button', { name: t.activity.loadMore })).toHaveCount(0);
    await expect(entries.filter({ hasText: BRUNO })).toHaveCount(1);
    await expect(entries.filter({ hasText: 'Gasto 0' })).toHaveCount(0);
    expect(await scrollsHorizontally(pageA)).toBe(false);

    await pageA.goto(`/en/groups/${groupId}/activity`);
    await expect(pageA.getByRole('heading', { level: 1, name: tEn.activity.title })).toBeVisible();
    await expect(pageA.getByText(tEn.activity.actions.expense_created).first()).toBeVisible();
    expect(await scrollsHorizontally(pageA)).toBe(false);
  } finally {
    await pair.close();
  }
});

test('a change waiting on the device is gone after signing out and another user sees none of it (data at rest)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'ge-signout', 'Casa de playa');
  const { pageA, groupId } = pair;
  try {
    const cena = await createExpense(pageA, groupId, pair.factsA, {
      amount: '1000000',
      description: 'Cena',
      memberIds: [pair.ana, pair.bruno],
    });
    await pageA.goto(expenseEditUrl(groupId, cena));
    await blockGroupWrites(pageA);
    await saveExpenseEdit(pageA, groupId, { description: 'Cena editada' });
    await expect(expenseRow(pageA, 'Cena editada')).toContainText(common.sync.pending);

    const userId = await pageA.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as { userId: string } | null)
          ?.userId ?? null,
    );
    if (userId === null) throw new Error('The app has not written the session pointer');
    expect(await databaseNames(pageA)).toContain(`pesly-${userId}`);

    const copy = catalogs.es.auth.signOut;
    await pageA.getByRole('button', { name: copy.label }).click();
    const dialog = pageA.getByRole('alertdialog', { name: copy.confirmTitle });
    await dialog
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => dialog.getByRole('button', { name: copy.confirm }).click())
      .catch(() => undefined);
    await expect(pageA).toHaveURL(/\/es\/sign-in$/);
    await expect.poll(() => databaseNames(pageA)).not.toContain(`pesly-${userId}`);

    // A second user on the same browser starts with nothing from the first.
    await signedInUser(pageA, 'ge-signout-2', 'Dora Ruiz');
    await pageA.goto('/es/groups');
    await expect(pageA.getByRole('status').filter({ hasText: /cambio de grupo/ })).toHaveCount(0);
    await requestPass(pageA);
    await expect(pageA.getByRole('status').filter({ hasText: /cambio/ })).toHaveCount(0);
  } finally {
    await pair.close();
  }
});
