import { formatMoney } from '@pesly/shared';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import {
  accountBalance,
  sendViaApi,
  archiveOtherExpenses,
  createExpenseMovement,
  deleteGroupExpense,
  expectNoHorizontalScroll,
  groupCategories,
  groupExpenses,
  movementTotal,
  rawApi,
  recordApiRequests,
  removeOtherExpenses,
  senderSetup,
  withCustomCategory,
  tapCounter,
  type SenderSetup,
} from './support/movement-to-group';
import { addGhostMember, createGroup, createInvitationLink, signedInUser } from './support/groups';
import { openRows } from './support/rows';

const es = catalogs.es;
const en = catalogs.en;
const send = es.movements.sendToGroup;
const list = es.movements.list;

const ANA = 'Ana Pérez';
const BRUNO = 'Bruno Gómez';
/** 40,000.00 ARS in minor units. */
const AMOUNT = '4000000';

function ars(minor: bigint, language: 'es' | 'en' = 'es'): string {
  return formatMoney(minor, 'ARS', language);
}

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

interface World {
  pageA: Page;
  pageB: Page;
  contextA: BrowserContext;
  groupId: string;
  setupA: SenderSetup;
  setupB: SenderSetup;
  close: () => Promise<void>;
}

/** Ana (admin) and Bruno in "Casa" with two ghost members: a group of 4; both have an account. */
async function world(browser: Browser, label: string): Promise<World> {
  const options = { locale: 'es-AR', timezoneId: 'America/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await signedInUser(pageA, `${label}-a`, ANA);
  await signedInUser(pageB, `${label}-b`, BRUNO);
  const groupId = await createGroup(pageA, 'Casa');
  await pageB.goto(await createInvitationLink(pageA));
  await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}$`));
  await addGhostMember(pageA, 'Carla');
  await addGhostMember(pageA, 'Dario');
  return {
    pageA,
    pageB,
    contextA,
    groupId,
    setupA: await senderSetup(pageA),
    setupB: await senderSetup(pageB),
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function rowOf(page: Page, movementId: string) {
  return page.locator(`#movement-row-${movementId}`);
}

function sendLink(page: Page, movementId: string) {
  return rowOf(page, movementId).getByRole('link', {
    name: new RegExp(list.actions.sendToGroup),
  });
}

test('from the list, a person sends a movement with the default split in at most 3 taps, nothing else changes, and the group shows it (AC-12, AC-13, AC-17, AC-18, AC-37, NFR-02, NFR-08)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-main');
  try {
    const { pageA: page } = w;
    // A second group, so choosing one is a real tap.
    const second = await createGroup(page, 'Viaje');
    const movementId = await createExpenseMovement(page, w.setupA, AMOUNT);
    const balanceBefore = await accountBalance(page, w.setupA.accountId);
    const totalBefore = await movementTotal(page);

    await page.goto('/es/movements');
    await expect(rowOf(page, movementId)).toBeVisible();
    const taps = tapCounter();
    const requests = recordApiRequests(page);
    const start = requests.mark();

    await taps.tap(sendLink(page, movementId));
    await expect(page).toHaveURL(new RegExp(`/es/movements/send\\?id=${movementId}$`));
    await expect(page.getByRole('radio', { name: 'Casa' })).toBeVisible();
    // Before a group is chosen: the movement, the groups and the account (for its currency).
    const beforeChoice = requests.since(start);
    expect(beforeChoice.sort()).toEqual(
      [`GET /movements/${movementId}`, 'GET /groups', `GET /accounts/${w.setupA.accountId}`].sort(),
    );
    // The summary shows the amount from the movement; the description is the editable default.
    await expect(page.getByText(ars(4_000_000n), { exact: false }).first()).toBeVisible();

    const afterLoad = requests.mark();
    await taps.tap(page.getByRole('radio', { name: 'Casa' }));
    const confirm = page.getByRole('button', { name: send.confirm });
    await expect(confirm).toBeVisible();
    await expect(page.getByLabel(send.description, { exact: true })).toHaveValue(
      send.defaultDescription,
    );
    // The default split is equal among the 4 members: 10,000.00 each.
    await expect(
      page.getByText(send.splitSummary.replace('{count}', '4').replace('{each}', ars(1_000_000n))),
    ).toBeVisible();
    expect(requests.since(afterLoad)).toEqual([`GET /groups/${w.groupId}/expense-options`]);

    const beforeSend = requests.mark();
    await taps.tap(confirm);
    await expect(page).toHaveURL(new RegExp(`/es/groups/${w.groupId}/expenses$`));
    expect(taps.count()).toBeLessThanOrEqual(3);
    expect(requests.since(beforeSend).filter((r) => r.startsWith('POST'))).toEqual([
      `POST /groups/${w.groupId}/expenses/from-movement`,
    ]);
    requests.stop();

    // The group shows the expense with the caller's share; nothing personal changed.
    const expenses = page.getByRole('list', { name: es.groups.expenses.label });
    await expect(expenses).toContainText(send.defaultDescription);
    await expect(expenses).toContainText(
      es.groups.expenses.yourShare.replace('{amount}', ars(1_000_000n)),
    );
    expect(await accountBalance(page, w.setupA.accountId)).toBe(balanceBefore);
    expect(await movementTotal(page)).toBe(totalBefore);
    const [expense] = await groupExpenses(page, w.groupId);
    expect(expense?.payerMovementId).toBe(movementId);
    expect(expense?.shares).toHaveLength(4);
    expect(expense?.amount).toBe(AMOUNT);
    expect(await groupExpenses(page, second)).toHaveLength(0);

    // The balance and the personal figures: 10,000.00 of 40,000.00 is mine, 30,000.00 is owed to me.
    await page.goto(`/es/groups/${w.groupId}`);
    await expect(
      page.getByText(es.groups.detail.ownBalance.owed.replace('{amount}', ars(3_000_000n))),
    ).toBeVisible();
    await page.goto('/es/groups/shares');
    await expect(page.getByRole('list', { name: es.groups.shares.listLabel })).toContainText(
      ars(1_000_000n),
    );

    // The activity page marks the entry as created from a movement, as text.
    await page.goto(`/es/groups/${w.groupId}/activity`);
    await expect(page.getByText(es.groups.activity.fromMovement)).toBeVisible();

    // The row now says where it went and offers no send icon.
    await page.goto('/es/movements');
    await expect(rowOf(page, movementId)).toContainText(list.inGroup.replace('{name}', 'Casa'));
    await expect(sendLink(page, movementId)).toHaveCount(0);

    // The edit screen shows the notice and the locked fields and offers no send action.
    await page.goto(`/es/movements/edit?id=${movementId}`);
    await expect(
      page.getByText(es.movements.edit.groupNotice.replace('{group}', 'Casa')),
    ).toBeVisible();
    await expect(page.getByText(es.movements.edit.lockedFields)).toBeVisible();
    await expect(
      page.getByRole('link', { name: new RegExp(list.actions.sendToGroup) }),
    ).toHaveCount(0);

    // A save of a locked field is refused by the server with the lock code (409).
    const refused = await rawApi(page, 'PUT', `/movements/${movementId}`, {
      type: 'expense',
      accountId: w.setupA.accountId,
      categoryId: w.setupA.categoryId,
      amount: '1',
      occurredAt: new Date(Date.now() - 120_000).toISOString(),
      rate: { source: 'keep' },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE' });

    // Deleting the group expense detaches the movement: it stays, personal and editable again.
    if (expense === undefined) throw new Error('No group expense');
    await deleteGroupExpense(page, w.groupId, expense);
    expect(await groupExpenses(page, w.groupId)).toHaveLength(0);
    expect(await movementTotal(page)).toBe(totalBefore);
    await page.goto('/es/movements');
    await expect(rowOf(page, movementId)).toBeVisible();
    await expect(rowOf(page, movementId)).not.toContainText('Casa');
    await expect(sendLink(page, movementId)).toBeVisible();
    await page.goto(`/es/movements/edit?id=${movementId}`);
    await expect(page.getByText(es.movements.edit.lockedFields)).toHaveCount(0);
    expect(await accountBalance(page, w.setupA.accountId)).toBe(balanceBefore);

    // Send it again, changing the split in the editor: one member out, so 3 share it equally.
    await page.goto(`/es/movements/send?id=${movementId}`);
    await page.getByRole('radio', { name: 'Casa' }).click();
    await page.getByRole('button', { name: send.changeSplit }).click();
    await page.getByRole('checkbox', { name: 'Dario' }).uncheck();
    await page.getByRole('button', { name: send.confirm }).click();
    await expect(page).toHaveURL(new RegExp(`/es/groups/${w.groupId}/expenses$`));
    const [again] = await groupExpenses(page, w.groupId);
    expect(again?.shares).toHaveLength(3);
    expect(again?.shares.reduce((sum, s) => sum + BigInt(s.amount), 0n)).toBe(BigInt(AMOUNT));
  } finally {
    await w.close();
  }
});

test('a member who is not an admin, with one group, sends in at most 2 taps (AC-35, NFR-08)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-member');
  try {
    const page = w.pageB;
    const movementId = await createExpenseMovement(page, w.setupB, '900000', 'Verdulería');
    await page.goto('/es/movements');
    const taps = tapCounter();
    await taps.tap(sendLink(page, movementId));
    // One group: it is preselected, so the options load without a tap.
    const confirm = page.getByRole('button', { name: send.confirm });
    await expect(confirm).toBeVisible();
    // A movement with a note carries it over as the description.
    await expect(page.getByLabel(send.description, { exact: true })).toHaveValue('Verdulería');
    await taps.tap(confirm);
    await expect(page).toHaveURL(new RegExp(`/es/groups/${w.groupId}/expenses$`));
    expect(taps.count()).toBeLessThanOrEqual(2);
    const [expense] = await groupExpenses(page, w.groupId);
    expect(expense?.description).toBe('Verdulería');
    expect(expense?.payerMovementId).toBe(movementId);
  } finally {
    await w.close();
  }
});

test('an empty description is refused on the screen and nothing is sent (invalid input)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-empty');
  try {
    const page = w.pageA;
    const movementId = await createExpenseMovement(page, w.setupA, AMOUNT);
    await page.goto(`/es/movements/send?id=${movementId}`);
    await page.getByLabel(send.description, { exact: true }).fill('');
    await page.getByRole('button', { name: send.confirm }).click();
    await expect(page.getByText(es.groups.expenses.form.errors.descriptionRequired)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/es/movements/send\\?id=${movementId}$`));
    expect(await groupExpenses(page, w.groupId)).toHaveLength(0);
  } finally {
    await w.close();
  }
});

test('a group whose Other expenses category was archived: the send restores it, shows the notice and stays within 3 taps (AC-46, AC-53)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-archived');
  try {
    const page = w.pageA;
    await archiveOtherExpenses(page, w.groupId);
    const custom = await withCustomCategory(page, w.setupA);
    const movementId = await createExpenseMovement(page, custom, AMOUNT);
    await page.goto('/es/movements');
    const taps = tapCounter();
    await taps.tap(sendLink(page, movementId));
    await taps.tap(page.getByRole('button', { name: send.confirm }));
    await expect(page.getByText(send.categoryRestored)).toBeVisible();
    expect(taps.count()).toBeLessThanOrEqual(3);
    const other = (await groupCategories(page, w.groupId)).find(
      (category) => category.defaultKey === 'other-expenses',
    );
    expect(other?.archivedAt).toBeNull();
    // The activity page says the default category came back by itself.
    await page.goto(`/es/groups/${w.groupId}/activity`);
    await expect(page.getByText(es.groups.activity.autoCategoryRestored)).toBeVisible();
  } finally {
    await w.close();
  }
});

test('a group with no Other expenses category gets it created by the send (AC-45, AC-52)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-missing');
  try {
    const page = w.pageA;
    await removeOtherExpenses(w.groupId);
    const custom = await withCustomCategory(page, w.setupA);
    const movementId = await createExpenseMovement(page, custom, AMOUNT);
    await page.goto(`/es/movements/send?id=${movementId}`);
    await page.getByRole('button', { name: send.confirm }).click();
    await expect(page.getByText(send.categoryCreated)).toBeVisible();
    const other = (await groupCategories(page, w.groupId)).filter(
      (category) => category.defaultKey === 'other-expenses',
    );
    expect(other).toHaveLength(1);
    expect(other[0]?.archivedAt).toBeNull();
    await page.goto(`/es/groups/${w.groupId}/activity`);
    await expect(page.getByText(es.groups.activity.autoCategoryCreated)).toBeVisible();
  } finally {
    await w.close();
  }
});

test('a second tab sending the same movement is told it was already sent and nothing is duplicated (AC-23, AC-24)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-twice');
  try {
    const first = w.pageA;
    const second = await w.contextA.newPage();
    const movementId = await createExpenseMovement(first, w.setupA, AMOUNT);
    const url = `/es/movements/send?id=${movementId}`;
    await first.goto(url);
    await second.goto(url);
    await expect(first.getByRole('button', { name: send.confirm })).toBeVisible();
    await expect(second.getByRole('button', { name: send.confirm })).toBeVisible();

    await first.getByRole('button', { name: send.confirm }).click();
    await expect(first).toHaveURL(new RegExp(`/es/groups/${w.groupId}/expenses$`));

    await second.getByRole('button', { name: send.confirm }).click();
    await expect(second.getByText(es.errors.groupMovementAlreadySent)).toBeVisible();
    expect(await groupExpenses(first, w.groupId)).toHaveLength(1);

    // Reopening the screen for a sent movement says so, without a form.
    await second.goto(url);
    await expect(second.getByText(send.alreadySent)).toBeVisible();
    await expect(second.getByRole('button', { name: send.confirm })).toHaveCount(0);
  } finally {
    await w.close();
  }
});

test('offline, the row offers no send icon (AC-39)', async ({ browser }) => {
  const w = await world(browser, 'm2g-offline');
  try {
    const page = w.pageA;
    const movementId = await createExpenseMovement(page, w.setupA, AMOUNT);
    await page.goto('/es/movements');
    await expect(sendLink(page, movementId)).toBeVisible();
    await w.contextA.setOffline(true);
    await expect(sendLink(page, movementId)).toHaveCount(0);
    await w.contextA.setOffline(false);
    await expect(sendLink(page, movementId)).toBeVisible();
  } finally {
    await w.close();
  }
});

test('the list opens at the focused movement, highlighted and in view, with working actions; a bad focus shows no highlight (AC-41, AC-42, AC-43, AC-44, NFR-09)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-focus');
  try {
    const page = w.pageA;
    // Enough movements that the target is not in the first screenful.
    const target = await createExpenseMovement(page, w.setupA, '12300', 'Objetivo de enfoque');
    for (let i = 0; i < 12; i += 1) {
      await createExpenseMovement(page, w.setupA, `${1000 + i}`, `Relleno ${i}`);
    }
    const focusId = target;

    const requests = recordApiRequests(page);
    const start = requests.mark();
    await page.goto(`/es/movements?focus=${focusId}`);
    const row = rowOf(page, focusId);
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeInViewport();
    // The list costs one page request, and focus costs none (no per-movement read).
    // The totals of the list are their own request, with the same filters.
    const listRequests = requests
      .since(start)
      .filter((r) => r.startsWith('GET /movements') && r !== 'GET /movements/summary');
    expect(listRequests.filter((r) => r === 'GET /movements').length).toBeLessThanOrEqual(1);
    expect(listRequests.filter((r) => r !== 'GET /movements')).toEqual([]);
    requests.stop();

    // Edit works on the highlighted row, once it is opened.
    await openRows(row);
    await row.getByRole('link', { name: new RegExp(`^${list.actions.edit}`) }).click();
    await expect(page).toHaveURL(`http://localhost:3000/es/movements/edit?id=${focusId}`);

    // Delete works on it too.
    await page.goto(`/es/movements?focus=${focusId}`);
    await openRows(rowOf(page, focusId));
    await rowOf(page, focusId)
      .getByRole('button', { name: new RegExp(`^${list.actions.delete}`) })
      .click();
    await page.getByRole('button', { name: list.actions.confirmDeleteYes }).click();
    await expect(rowOf(page, focusId)).toHaveCount(0);

    // A random uuid and a malformed value: the list, no highlight, no alert.
    for (const bad of ['5b1f4c86-0f3e-4c57-9d07-3c3f7f2a9b10', 'abc']) {
      await page.goto(`/es/movements?focus=${bad}`);
      await expect(page.getByRole('listitem').first()).toBeVisible();
      await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    }
  } finally {
    await w.close();
  }
});

test('at 360 px wide the send screen, the list rows, and the edit notice do not scroll sideways (NFR-01)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-360');
  try {
    const page = w.pageA;
    await page.setViewportSize({ width: 360, height: 740 });
    const open = await createExpenseMovement(
      page,
      w.setupA,
      AMOUNT,
      'Una compra con una nota bastante larga para probar el ancho',
    );
    const sent = await createExpenseMovement(page, w.setupA, '250000', 'Ya enviado');
    await sendViaApi(page, w.groupId, sent);

    await page.goto('/es/movements');
    await expect(sendLink(page, open)).toBeVisible();
    await expect(rowOf(page, sent)).toContainText(list.inGroup.replace('{name}', 'Casa'));
    await expectNoHorizontalScroll(page);

    await page.goto(`/es/movements/send?id=${open}`);
    await expect(page.getByRole('button', { name: send.confirm })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: send.changeSplit }).click();
    await expectNoHorizontalScroll(page);

    await page.goto(`/es/movements/edit?id=${sent}`);
    await expect(page.getByText(es.movements.edit.lockedFields)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(`/es/groups/${w.groupId}/activity`);
    await expect(page.getByText(es.groups.activity.fromMovement)).toBeVisible();
    await expectNoHorizontalScroll(page);
  } finally {
    await w.close();
  }
});

test('the screens render in English with the English catalog (AC-34, NFR-04)', async ({
  browser,
}) => {
  const w = await world(browser, 'm2g-en');
  try {
    const page = w.pageA;
    const movementId = await createExpenseMovement(page, w.setupA, AMOUNT);
    const sentId = await createExpenseMovement(page, w.setupA, '250000', 'Sent already');
    await sendViaApi(page, w.groupId, sentId);

    await page.goto('/en/movements');
    await expect(rowOf(page, sentId)).toContainText(
      en.movements.list.inGroup.replace('{name}', 'Casa'),
    );
    await expect(
      rowOf(page, movementId).getByRole('link', {
        name: new RegExp(en.movements.list.actions.sendToGroup),
      }),
    ).toBeVisible();

    await page.goto(`/en/movements/send?id=${movementId}`);
    await expect(page.getByRole('heading', { name: en.movements.sendToGroup.title })).toBeVisible();
    await expect(
      page.getByRole('button', { name: en.movements.sendToGroup.confirm }),
    ).toBeVisible();
    await expect(
      page.getByLabel(en.movements.sendToGroup.description, { exact: true }),
    ).toHaveValue(en.movements.sendToGroup.defaultDescription);

    await page.goto(`/en/movements/edit?id=${sentId}`);
    await expect(
      page.getByText(en.movements.edit.groupNotice.replace('{group}', 'Casa')),
    ).toBeVisible();

    await page.goto(`/en/groups/${w.groupId}/activity`);
    await expect(page.getByText(en.groups.activity.fromMovement)).toBeVisible();
  } finally {
    await w.close();
  }
});
