// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupExpensesContainer } from '../src/features/groups/expenses/list/group-expenses-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ME = '77777777-7777-4777-8777-777777777771';
const ANA = '77777777-7777-4777-8777-777777777772';
const FOOD = '66666666-6666-4666-8666-666666666661';
const LIST = `GET /groups/${GROUP_ID}/expenses?limit=50`;
const MORE = (cursor: string) => `GET /groups/${GROUP_ID}/expenses?limit=50&cursor=${cursor}`;
const OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;

const options = {
  selfMemberId: ME,
  members: [
    { id: ME, displayName: 'Joaquin', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
  ],
  categories: [
    { id: FOOD, defaultKey: null, name: 'Groceries', icon: 'utensils', color: 'orange', archivedAt: null },
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
  renderApp(<GroupExpensesContainer groupId={GROUP_ID} viewerMemberId={ME} />, { locale });

describe('GroupExpensesContainer', () => {
  it('shows description, category, payer, amount, date and the viewer share, newest first', async () => {
    stubApi({
      [LIST]: {
        status: 200,
        body: { items: [expense(2, { occurredAt: '2026-10-06T10:00:00.000Z' }), expense(1)], nextCursor: null },
      },
      [OPTIONS]: { status: 200, body: options },
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
    });
    open();
    expect(await screen.findByText(en.groups.expenses.empty.title)).toBeTruthy();
    const link = screen.getAllByRole('link', { name: en.groups.expenses.add })[0];
    expect(link?.getAttribute('href')).toContain(`/groups/${GROUP_ID}/expenses/new`);
  });

  it('shows a retry on a load error and loads again', async () => {
    const { calls } = stubApi({
      [LIST]: [
        { status: 500 },
        { status: 200, body: { items: [expense(1)], nextCursor: null } },
      ],
      [OPTIONS]: { status: 200, body: options },
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

  it('makes at most 2 requests on the first load', async () => {
    const { calls } = stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
    });
    open();
    await screen.findByText('Expense 1');
    await waitFor(() => {
      expect(calls.length).toBeLessThanOrEqual(2);
    });
  });

  it('renders Spanish strings', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [expense(1)], nextCursor: 'C' } },
      [OPTIONS]: { status: 200, body: options },
    });
    open('es');
    expect(await screen.findByRole('button', { name: es.groups.expenses.loadMore })).toBeTruthy();
    expect(screen.getByText(/15\.000,50/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.groups.expenses.title })).toBeTruthy();
  });
});
