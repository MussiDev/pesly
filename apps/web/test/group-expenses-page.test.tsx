// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupExpensesPage } from '../src/features/groups/category-views/group-expenses-page';
import { formatMoney } from '../src/lib/format-amount';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ME = '77777777-7777-4777-8777-777777777771';
const ANA = '77777777-7777-4777-8777-777777777772';
const FOOD = '66666666-6666-4666-8666-666666666661';
const RENT = '66666666-6666-4666-8666-666666666662';
const OLD = '66666666-6666-4666-8666-666666666663';
const USER = '11111111-1111-4111-8111-111111111111';
const OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;
const GROUP_KEY = `GET /groups/${GROUP_ID}`;

const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' };
const SEP = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' };

const listKey = (params: { categoryIds?: string[]; from: string; to: string }) => {
  const query = new URLSearchParams({ limit: '50' });
  if (params.categoryIds !== undefined) query.set('categoryIds', params.categoryIds.join(','));
  query.set('from', params.from);
  query.set('to', params.to);
  return `GET /groups/${GROUP_ID}/expenses?${query.toString()}`;
};
const summaryKey = (range: { from: string; to: string }) =>
  `GET /groups/${GROUP_ID}/expenses/summary?${new URLSearchParams(range).toString()}`;

const category = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  defaultKey: null,
  name,
  icon: 'utensils',
  color: 'orange',
  archivedAt: null,
  ...overrides,
});

const CATEGORIES = [
  category(FOOD, 'Groceries'),
  category(RENT, 'Rent', { icon: 'home' }),
  category(OLD, 'Old things', { archivedAt: '2026-01-01T00:00:00.000Z' }),
];

const options = {
  selfMemberId: ME,
  members: [
    { id: ME, displayName: 'Joaquin', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
  ],
  categories: CATEGORIES,
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
};

const groupDetail = {
  id: GROUP_ID,
  name: 'Casa',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ME,
  members: [
    {
      id: ME,
      displayName: 'Joaquin',
      isGhost: false,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: ANA,
      displayName: 'Ana',
      isGhost: false,
      role: 'admin',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  formerMembers: [],
};

const expense = (n: number, categoryId: string) => ({
  id: `88888888-8888-4888-8888-88888888${String(n).padStart(4, '0')}`,
  groupId: GROUP_ID,
  payerMemberId: ANA,
  createdByMemberId: ANA,
  amount: '1500050',
  currency: 'ARS',
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId,
  description: `Expense ${n}`,
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  shares: [
    { memberId: ME, amount: '750025' },
    { memberId: ANA, amount: '750025' },
  ],
  version: 1,
});

const page = (...items: ReturnType<typeof expense>[]) => ({
  status: 200,
  body: { items, nextCursor: null },
});

const summary = (
  range: { from: string; to: string },
  lines: { categoryId: string; total: string; count: number }[],
) => ({
  status: 200,
  body: {
    ...range,
    currencies:
      lines.length === 0
        ? []
        : [
            {
              currency: 'ARS',
              total: lines.reduce(
                (sum, line) => (BigInt(sum) + BigInt(line.total)).toString(),
                '0',
              ),
              count: lines.reduce((sum, line) => sum + line.count, 0),
              categories: lines,
            },
          ],
    categories: CATEGORIES,
  },
});

const octSummary = summary(OCT, [
  { categoryId: FOOD, total: '700000', count: 2 },
  { categoryId: RENT, total: '300000', count: 1 },
]);

function routes(extra: Record<string, unknown> = {}) {
  return {
    [listKey(OCT)]: page(expense(1, FOOD), expense(2, RENT)),
    [listKey({ categoryIds: [FOOD], ...OCT })]: page(expense(1, FOOD)),
    [listKey({ categoryIds: [FOOD, RENT], ...OCT })]: page(expense(1, FOOD), expense(2, RENT)),
    [listKey({ categoryIds: [RENT], ...OCT })]: page(expense(2, RENT)),
    [listKey(SEP)]: page(expense(3, FOOD)),
    [summaryKey(OCT)]: octSummary,
    [summaryKey(SEP)]: summary(SEP, [{ categoryId: OLD, total: '500', count: 1 }]),
    [OPTIONS]: { status: 200, body: options },
    [GROUP_KEY]: { status: 200, body: groupDetail },
    ...extra,
  } as Parameters<typeof stubApi>[0];
}

const open = (locale: 'en' | 'es' = 'en', id = GROUP_ID) =>
  renderApp(<GroupExpensesPage groupId={id} />, { locale });

const filterGroup = (locale: 'en' | 'es' = 'en') =>
  screen.getByRole('group', { name: CATALOGS[locale].groups.categoryViews.filter.label });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GroupExpensesPage', () => {
  it('selects the current month and both sections request its bounds', async () => {
    const { calls } = stubApi(routes());
    open();
    await screen.findByText('Expense 1');
    const picker = screen.getByLabelText(en.groups.categoryViews.month.label);
    expect(picker).toHaveProperty('value', '2026-10');
    expect(calls.map((call) => call.path)).toContain(listKey(OCT).replace('GET ', ''));
    expect(calls.map((call) => call.path)).toContain(summaryKey(OCT).replace('GET ', ''));
  });

  it('renders the title and back link before the month picker, and the picker before the list', async () => {
    stubApi(routes());
    open();
    await screen.findByText('Expense 1');
    const heading = screen.getByRole('heading', { name: en.groups.expenses.title });
    const back = screen.getByRole('link', { name: en.groups.expenses.back });
    const picker = screen.getByLabelText(en.groups.categoryViews.month.label);
    const row = screen.getByText('Expense 1');
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(heading, picker)).toBe(true);
    expect(before(back, picker)).toBe(true);
    expect(before(picker, row)).toBe(true);
  });

  it('makes 4 requests on load and 2 on a month change, offering no future or too old month', async () => {
    const { calls } = stubApi(routes());
    open();
    await screen.findByText('Expense 1');
    await screen.findByText(en.groups.categoryViews.summarySection.title);
    expect(calls).toHaveLength(4);
    const picker = screen.getByLabelText(en.groups.categoryViews.month.label);
    const values = [...picker.querySelectorAll('option')].map((option) => option.value);
    expect(values[0]).toBe('2026-10');
    expect(values).not.toContain('2026-11');
    expect(values).toHaveLength(121);
    expect(values).not.toContain('2016-09');
    await userEvent.selectOptions(picker, '2026-09');
    await screen.findByText('Expense 3');
    await waitFor(() => {
      expect(calls).toHaveLength(6);
    });
    expect(calls.slice(4).map((call) => call.path)).toEqual(
      expect.arrayContaining([
        listKey(SEP).replace('GET ', ''),
        summaryKey(SEP).replace('GET ', ''),
      ]),
    );
  });

  it('filters by one or several categories and shows the month again when cleared', async () => {
    stubApi(routes());
    open();
    await screen.findByText('Expense 2');
    const food = within(filterGroup()).getByRole('button', { name: /Groceries/ });
    await userEvent.click(food);
    await waitFor(() => {
      expect(screen.queryByText('Expense 2')).toBeNull();
    });
    expect(screen.getByText('Expense 1')).toBeTruthy();
    await userEvent.click(within(filterGroup()).getByRole('button', { name: /Rent/ }));
    await screen.findByText('Expense 2');
    expect(screen.getByText('Expense 1')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: en.groups.categoryViews.filter.clear }),
    );
    await screen.findByText('Expense 2');
    expect(
      screen.queryByRole('group', { name: en.groups.categoryViews.filter.activeLabel }),
    ).toBeNull();
  });

  it('filters by a tapped summary line, replaces a previous filter and shows the same total', async () => {
    stubApi(routes());
    open();
    await screen.findByText('Expense 2');
    const summarySection = await screen.findByRole('region', {
      name: en.groups.categoryViews.summarySection.title,
    });
    await userEvent.click(within(summarySection).getByRole('button', { name: /Groceries/ }));
    await waitFor(() => {
      expect(screen.queryByText('Expense 2')).toBeNull();
    });
    const active = screen.getByRole('group', { name: en.groups.categoryViews.filter.activeLabel });
    expect(
      within(active).getByRole('button', {
        name: en.groups.categoryViews.filter.remove.replace('{name}', 'Groceries'),
      }),
    ).toBeTruthy();
    const amount = formatMoney(700000n, 'ARS', 'en').replace(/\s/g, ' ');
    const lines = screen.getAllByText((content) => content.replace(/\s/g, ' ') === amount);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    await userEvent.click(within(summarySection).getByRole('button', { name: /Rent/ }));
    await screen.findByText('Expense 2');
    expect(screen.queryByText('Expense 1')).toBeNull();
    expect(within(active).queryByText('Groceries')).toBeNull();
  });

  it('offers an archived category only when the month summary has a line for it', async () => {
    stubApi(routes());
    open();
    await screen.findByText('Expense 2');
    expect(within(filterGroup()).queryByText(/Old things/)).toBeNull();
    await userEvent.selectOptions(
      screen.getByLabelText(en.groups.categoryViews.month.label),
      '2026-09',
    );
    await waitFor(() => {
      expect(within(filterGroup()).getByText(/Old things/)).toBeTruthy();
    });
  });

  it('keeps the list working when the summary fails and offers retry', async () => {
    const { calls } = stubApi(routes({ [summaryKey(OCT)]: { status: 500 } }));
    open();
    expect(await screen.findByText('Expense 1')).toBeTruthy();
    const retry = await screen.findByRole('button', { name: en.app.retry });
    expect(screen.getByLabelText(en.groups.categoryViews.month.label)).toBeTruthy();
    await userEvent.click(retry);
    await waitFor(() => {
      expect(calls.filter((call) => call.path.includes('/summary')).length).toBe(2);
    });
    expect(screen.getByText('Expense 1')).toBeTruthy();
  });

  it('keeps the controls and the summary when the list fails (AC-30)', async () => {
    const { calls } = stubApi(routes({ [listKey(OCT)]: { status: 500 } }));
    open();
    expect(await screen.findByText('Groceries')).toBeTruthy();
    await screen.findByRole('button', { name: en.app.retry });
    expect(screen.getByLabelText(en.groups.categoryViews.month.label)).toBeTruthy();
    expect(
      screen.getByRole('region', { name: en.groups.categoryViews.summarySection.title }),
    ).toBeTruthy();
    expect(calls.filter((call) => call.path.includes('/summary'))).toHaveLength(1);
  });

  it('shows the controls and requests the summary while the list is still loading', async () => {
    const calls: string[] = [];
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = url.slice(url.indexOf('/groups'));
        calls.push(path);
        if (path.includes('/expenses/summary')) return Promise.resolve(json(octSummary.body));
        if (path.includes('/expenses?')) return new Promise<Response>(() => undefined);
        if (path.endsWith('/expense-options')) return Promise.resolve(json(options));
        return Promise.resolve(json(groupDetail));
      }),
    );
    open();
    expect(screen.getByLabelText(en.groups.categoryViews.month.label)).toBeTruthy();
    expect(await screen.findByText('Groceries')).toBeTruthy();
    expect(screen.queryByText('Expense 1')).toBeNull();
  });

  it('shows no controls when the group is not found', async () => {
    stubApi(routes({ [listKey(OCT)]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    open();
    await screen.findByText(en.groups.detail.notFound.title);
    expect(screen.queryByLabelText(en.groups.categoryViews.month.label)).toBeNull();
  });

  it('shows not-found and sends no request for a malformed group id', () => {
    const { calls } = stubApi(routes());
    open('en', 'not-a-uuid');
    expect(calls).toHaveLength(0);
    expect(screen.getByText(en.groups.detail.notFound.title)).toBeTruthy();
  });

  it('renders in Spanish and English without hardcoded strings', async () => {
    stubApi(routes());
    const first = open('es');
    expect(await screen.findByText('Expense 1')).toBeTruthy();
    expect(screen.getByLabelText(es.groups.categoryViews.month.label)).toBeTruthy();
    expect(screen.getByRole('group', { name: es.groups.categoryViews.filter.label })).toBeTruthy();
    expect(screen.getByRole('region', { name: es.groups.categoryViews.page.filters })).toBeTruthy();
    first.unmount();
    stubApi(routes());
    open('en');
    expect(await screen.findByText('Expense 1')).toBeTruthy();
    expect(screen.getByLabelText(en.groups.categoryViews.month.label)).toBeTruthy();
    expect(screen.getByRole('region', { name: en.groups.categoryViews.page.filters })).toBeTruthy();
  });
});
