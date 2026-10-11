// @vitest-environment happy-dom
import type { GroupExpenseResponse } from '@pesly/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupExpensesContainer } from '../src/features/groups/expenses/list/group-expenses-container';
import {
  discardGroupChange,
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  queueGroupDelete,
  queueGroupUpdate,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import {
  MOVEMENT_QUEUED_EVENT,
  notifyQueueChanged,
  notifySyncFinished,
} from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ME = '77777777-7777-4777-8777-777777777771';
const ANA = '77777777-7777-4777-8777-777777777772';
const FOOD = '66666666-6666-4666-8666-666666666661';
const LIST = `GET /groups/${GROUP_ID}/expenses?limit=50`;
const MORE = (cursor: string) => `GET /groups/${GROUP_ID}/expenses?limit=50&cursor=${cursor}`;
const OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;
const GROUP_KEY = `GET /groups/${GROUP_ID}`;
const USER = '11111111-1111-4111-8111-111111111111';

const groupDetail = (role: 'admin' | 'member' = 'member') => ({
  id: GROUP_ID,
  name: 'Casa',
  defaultRateType: 'blue',
  role,
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ME,
  members: [
    { id: ME, displayName: 'Joaquin', isGhost: false, role, joinedAt: '2026-10-01T00:00:00.000Z' },
    {
      id: ANA,
      displayName: 'Ana',
      isGhost: false,
      role: role === 'admin' ? 'member' : 'admin',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  formerMembers: [],
});

const options = {
  selfMemberId: ME,
  members: [
    { id: ME, displayName: 'Joaquin', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
  ],
  categories: [
    {
      id: FOOD,
      defaultKey: null,
      name: 'Groceries',
      icon: 'utensils',
      color: 'orange',
      archivedAt: null,
    },
  ],
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
};

const expense = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `88888888-8888-4888-8888-88888888${String(n).padStart(4, '0')}`,
  groupId: GROUP_ID,
  payerMemberId: ANA,
  createdByMemberId: ANA,
  amount: '1500050',
  currency: 'ARS',
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId: FOOD,
  description: `Expense ${n}`,
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  shares: [
    { memberId: ME, amount: '750025' },
    { memberId: ANA, amount: '750025' },
  ],
  version: 1,
  ...overrides,
});

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupExpensesContainer groupId={GROUP_ID} />, { locale });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
});

describe('GroupExpensesContainer', () => {
  it('shows description, category, payer, amount, date and the viewer share, newest first', async () => {
    stubApi({
      [LIST]: {
        status: 200,
        body: {
          items: [expense(2, { occurredAt: '2026-10-06T10:00:00.000Z' }), expense(1)],
          nextCursor: null,
        },
      },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    const first = (await screen.findByText('Expense 2')).closest('li');
    if (!first) throw new Error('no row');
    const row = within(first);
    expect(row.getByText('Groceries')).toBeTruthy();
    expect(row.getByText(/Ana/)).toBeTruthy();
    expect(row.getByText(/15,000\.50/)).toBeTruthy();
    expect(row.getByText(/7,500\.25/)).toBeTruthy();
    expect(row.getByText(/Oct 6, 2026/)).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Expense 2');
    expect(items[1]).toContain('Expense 1');
  });

  it('loads more without reloading and hides the button when nextCursor is null', async () => {
    const { calls } = stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: 'CUR1' } },
      [MORE('CUR1')]: { status: 200, body: { items: [expense(2)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.groups.expenses.loadMore }));
    expect(await screen.findByText('Expense 2')).toBeTruthy();
    expect(screen.getByText('Expense 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.groups.expenses.loadMore })).toBeNull();
    expect(calls.filter((call) => call.path.includes('/expenses?limit=50')).length).toBe(2);
    expect(calls.filter((call) => call.path.endsWith('/expense-options')).length).toBe(1);
  });

  it('shows the empty state with the add expense action', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    expect(await screen.findByText(en.groups.expenses.empty.title)).toBeTruthy();
    const link = screen.getAllByRole('link', { name: en.groups.expenses.add })[0];
    expect(link?.getAttribute('href')).toContain(`/groups/${GROUP_ID}/expenses/new`);
  });

  it('shows a retry on a load error and loads again', async () => {
    const { calls } = stubApi({
      [LIST]: [{ status: 500 }, { status: 200, body: { items: [expense(1)], nextCursor: null } }],
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByText('Expense 1')).toBeTruthy();
    expect(calls.filter((call) => call.path.includes('/expenses?limit=50')).length).toBe(2);
  });

  it('keeps the loaded rows when load more fails and offers a retry', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: 'CUR1' } },
      [MORE('CUR1')]: [
        { status: 500 },
        { status: 200, body: { items: [expense(2)], nextCursor: null } },
      ],
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.groups.expenses.loadMore }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Expense 1')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    expect(await screen.findByText('Expense 2')).toBeTruthy();
    expect(screen.getByText('Expense 1')).toBeTruthy();
  });

  it('shows the not-found state with a link back on a 404', async () => {
    stubApi({
      [LIST]: { status: 404, body: { code: 'NOT_FOUND' } },
      [OPTIONS]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    open();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en.groups.detail.notFound.back }).getAttribute('href'),
    ).toContain('/groups');
  });

  it('makes exactly 3 requests on the first load: the page, the options and the group', async () => {
    const { calls } = stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    await screen.findByText('Expense 1');
    await waitFor(() => {
      expect(calls.length).toBeLessThanOrEqual(3);
    });
    expect(calls.map((call) => call.path).sort()).toEqual(
      [
        `/groups/${GROUP_ID}`,
        `/groups/${GROUP_ID}/expense-options`,
        `/groups/${GROUP_ID}/expenses?limit=50`,
      ].sort(),
    );
  });

  it('renders Spanish strings', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: 'C' } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open('es');
    expect(await screen.findByRole('button', { name: es.groups.expenses.loadMore })).toBeTruthy();
    expect(screen.getByText(/15\.000,50/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.groups.expenses.title })).toBeTruthy();
  });

  it('shows the not-found state for a malformed group id and sends no request', () => {
    const { calls } = stubApi({});
    renderApp(<GroupExpensesContainer groupId="not-a-uuid" />, { locale: 'en' });
    expect(screen.getByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('ignores a load-more answer that arrives after the group changed', async () => {
    const OTHER = '55555555-5555-4555-8555-555555555556';
    const stub = stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: 'CUR1' } },
      [MORE('CUR1')]: {
        status: 200,
        body: { items: [expense(2)], nextCursor: null },
      },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
      [`GET /groups/${OTHER}/expenses?limit=50`]: {
        status: 200,
        body: { items: [expense(9, { groupId: OTHER })], nextCursor: null },
      },
      [`GET /groups/${OTHER}/expense-options`]: { status: 200, body: options },
      [`GET /groups/${OTHER}`]: { status: 200, body: groupDetail() },
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('cursor=CUR1') ? held.then(() => stub.fetch(url, init)) : stub.fetch(url, init),
    );
    const view = open();
    await userEvent.click(await screen.findByRole('button', { name: en.groups.expenses.loadMore }));

    view.rerender(<GroupExpensesContainer groupId={OTHER} />);
    expect(await screen.findByText('Expense 9')).toBeTruthy();
    release();
    await waitFor(() => {
      expect(stub.calls.some((call) => call.path.includes('cursor=CUR1'))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText('Expense 2')).toBeNull();
    expect(screen.queryByText('Expense 1')).toBeNull();
    expect(screen.getByText('Expense 9')).toBeTruthy();
  });
});

const mine = (n: number) =>
  expense(n, { payerMemberId: ME, createdByMemberId: ME }) as unknown as GroupExpenseResponse;
const rowOf = async (text: string): Promise<HTMLElement> => {
  const li = (await screen.findByText(text)).closest('li');
  if (!li) throw new Error('no row');
  return li;
};
const common = en.groups.edit.common;

async function seed(work: (database: IDBDatabase) => Promise<unknown>) {
  await withGroupQueue(USER, async (database) => {
    await work(database);
    return true;
  });
}

const readQueue = () => withGroupQueue(USER, (database) => loadGroupQueue(database));

const editRequest = (amount: string) => ({
  amount,
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId: FOOD,
  description: 'Expense 1',
  split: { mode: 'equal' as const, memberIds: [ME, ANA] },
});

function stubOne(role: 'admin' | 'member', items: unknown[]) {
  return stubApi({
    [LIST]: { status: 200, body: { items, nextCursor: null } },
    [OPTIONS]: { status: 200, body: options },
    [GROUP_KEY]: { status: 200, body: groupDetail(role) },
  });
}

describe('GroupExpensesContainer edit actions (DISC-001-05h Block 7)', () => {
  it("shows edit and delete on the caller's own rows and neither on another member's", async () => {
    stubOne('member', [mine(1), expense(2)]);
    open();
    const own = within(await rowOf('Expense 1'));
    expect(
      (await own.findByRole('link', { name: common.actions.edit })).getAttribute('href'),
    ).toContain(`/groups/${GROUP_ID}/expenses/${mine(1).id}/edit`);
    expect(own.getByRole('button', { name: common.actions.delete })).toBeTruthy();
    const other = within(await rowOf('Expense 2'));
    expect(other.queryByRole('link', { name: common.actions.edit })).toBeNull();
    expect(other.queryByRole('button', { name: common.actions.delete })).toBeNull();
  });

  it("shows edit and delete on another member's row to an admin", async () => {
    stubOne('admin', [expense(2)]);
    open();
    const row = within(await rowOf('Expense 2'));
    expect(await row.findByRole('button', { name: common.actions.delete })).toBeTruthy();
  });

  it('marks a row with a queued update as waiting and shows the queued values', async () => {
    await seed((database) =>
      queueGroupUpdate(database, {
        kind: 'expense',
        base: mine(1),
        request: editRequest('2000000'),
      }),
    );
    stubOne('member', [mine(1)]);
    open();
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByText(common.sync.pending)).toBeTruthy();
    expect(row.getByText(/20,000\.00/)).toBeTruthy();
    expect(row.queryByText(/15,000\.50/)).toBeNull();
  });

  it('hides a row with a queued delete', async () => {
    await seed((database) => queueGroupDelete(database, { kind: 'expense', base: mine(1) }));
    stubOne('member', [mine(1), mine(2)]);
    open();
    await screen.findByText('Expense 2');
    await waitFor(() => {
      expect(screen.queryByText('Expense 1')).toBeNull();
    });
  });

  it('marks a rejected row as failed; retry queues it again and asks for a pass', async () => {
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: mine(1),
        request: editRequest('2000000'),
      });
      await markGroupRejected(database, 'expense', mine(1).id, 'GROUP_RECORD_EDIT_FORBIDDEN');
    });
    stubOne('member', [mine(1)]);
    const queued = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, queued);
    open();
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByText(common.sync.failed)).toBeTruthy();
    await userEvent.click(row.getByRole('button', { name: common.actions.retry }));
    await waitFor(() => {
      expect(queued).toHaveBeenCalled();
    });
    expect((await readQueue())[0]?.rejection).toBeUndefined();
    expect(await within(await rowOf('Expense 1')).findByText(common.sync.pending)).toBeTruthy();
  });

  it('discard shows the record as the server holds it; a final reason offers only discard', async () => {
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: mine(1),
        request: editRequest('2000000'),
      });
      await markGroupRejected(database, 'expense', mine(1).id, 'GROUP_RECORD_FORMER_MEMBER');
    });
    stubOne('member', [mine(1)]);
    open();
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByText(common.sync.failed)).toBeTruthy();
    expect(row.queryByRole('button', { name: common.actions.retry })).toBeNull();
    await userEvent.click(row.getByRole('button', { name: common.actions.discard }));
    await waitFor(() => {
      expect(screen.queryByText(common.sync.failed)).toBeNull();
    });
    expect(within(await rowOf('Expense 1')).getByText(/15,000\.50/)).toBeTruthy();
    expect(await readQueue()).toHaveLength(0);
  });

  it('marks a row in conflict and links to the resolution', async () => {
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: mine(1),
        request: editRequest('2000000'),
      });
      await markGroupConflict(database, 'expense', mine(1).id, 1, { ...mine(1), version: 2 });
    });
    stubOne('member', [mine(1)]);
    open();
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByText(common.sync.conflict)).toBeTruthy();
    expect(row.getByRole('link', { name: common.actions.resolve }).getAttribute('href')).toContain(
      `/groups/${GROUP_ID}/expenses/${mine(1).id}/edit`,
    );
  });

  it('shows the server values with no marker after the pass finished', async () => {
    await seed((database) =>
      queueGroupUpdate(database, {
        kind: 'expense',
        base: mine(1),
        request: editRequest('2000000'),
      }),
    );
    stubApi({
      [LIST]: [
        { status: 200, body: { items: [mine(1)], nextCursor: null } },
        {
          status: 200,
          body: { items: [{ ...mine(1), amount: '2000000', version: 2 }], nextCursor: null },
        },
      ],
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 200, body: groupDetail() },
    });
    open();
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByText(common.sync.pending)).toBeTruthy();
    await seed((database) => discardGroupChange(database, 'expense', mine(1).id));
    act(() => {
      notifyQueueChanged();
      notifySyncFinished();
    });
    await waitFor(() => {
      expect(screen.queryByText(common.sync.pending)).toBeNull();
    });
    await waitFor(async () => {
      expect(within(await rowOf('Expense 1')).getByText(/20,000\.00/)).toBeTruthy();
    });
  });

  it('confirming a deletion queues it and cancelling leaves the queue unchanged', async () => {
    stubOne('member', [mine(1)]);
    open();
    const del = common.actions.delete;
    await userEvent.click(
      await within(await rowOf('Expense 1')).findByRole('button', { name: del }),
    );
    await userEvent.click(screen.getByRole('button', { name: common.deleteConfirm.cancel }));
    expect(await readQueue()).toHaveLength(0);
    expect(screen.queryByText(common.deleteConfirm.title)).toBeNull();

    await userEvent.click(within(await rowOf('Expense 1')).getByRole('button', { name: del }));
    await userEvent.click(screen.getByRole('button', { name: common.deleteConfirm.confirm }));
    await waitFor(() => {
      expect(screen.queryByText('Expense 1')).toBeNull();
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operation: 'delete' });
  });

  it('shows not-found on a 404 from getGroup', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [mine(1)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    open();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
  });

  it('shows load-failed with retry on any other getGroup error', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [mine(1)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
      [GROUP_KEY]: [{ status: 500 }, { status: 200, body: groupDetail() }],
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByText('Expense 1')).toBeTruthy();
  });

  it('shows the unavailable text once and keeps the rows when the queue is unavailable', async () => {
    localStorage.clear();
    stubOne('member', [mine(1), mine(2)]);
    open();
    expect(await screen.findByText('Expense 2')).toBeTruthy();
    expect(await screen.findAllByText(common.unavailable)).toHaveLength(1);
    expect(screen.getByText('Expense 1')).toBeTruthy();
  });

  it('renders the edit controls in Spanish', async () => {
    stubOne('member', [mine(1)]);
    open('es');
    const row = within(await rowOf('Expense 1'));
    expect(await row.findByRole('link', { name: es.groups.edit.common.actions.edit })).toBeTruthy();
    expect(row.getByRole('button', { name: es.groups.edit.common.actions.delete })).toBeTruthy();
  });
});
