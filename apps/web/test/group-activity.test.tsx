// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupActivityContainer } from '../src/features/groups/activity/group-activity-container';
import { formatDateTime, formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '77777777-7777-4777-8777-777777777771';
const BEA = '77777777-7777-4777-8777-777777777772';
const OLD = '77777777-7777-4777-8777-777777777773';
const CAT_FOOD = '99999999-9999-4999-8999-999999999991';
const CAT_HOME = '99999999-9999-4999-8999-999999999992';
const NBSP = String.fromCharCode(0xa0);
const money = (value: bigint, currency: 'ARS' | 'USD', language: 'en' | 'es' = 'en'): string =>
  formatMoney(value, currency, language).replaceAll(NBSP, ' ');
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const FIRST_PAGE = `GET /groups/${GROUP_ID}/activity?limit=50`;
const SECOND_PAGE = `GET /groups/${GROUP_ID}/activity?limit=50&cursor=next-1`;
const CATEGORIES = `GET /groups/${GROUP_ID}/categories`;
const XSS = '<img src=x onerror=alert(1)>';

const member = (id: string, displayName: string | null, role = 'member') => ({
  id,
  displayName,
  isGhost: false,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const group = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [member(ANA, 'Ana', 'admin'), member(BEA, 'Bea')],
  formerMembers: [{ id: OLD, displayName: 'Old Pal', leftAt: '2026-10-03T00:00:00.000Z' }],
};

const expenseSnapshot = (overrides: Record<string, unknown> = {}) => ({
  amount: '100000',
  currency: 'ARS',
  occurredAt: '2026-10-10T15:00:00.000Z',
  categoryId: CAT_FOOD,
  description: 'Dinner',
  splitMode: 'equal',
  payerMemberId: ANA,
  shares: [
    { memberId: ANA, amount: '50000' },
    { memberId: BEA, amount: '50000' },
  ],
  ...overrides,
});

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  action: 'expense_created',
  subjectType: 'expense',
  subjectId: 'subject-1',
  memberId: ANA,
  createdAt: '2026-10-11T12:00:00.000Z',
  before: null,
  after: null,
  fromMovement: false,
  autoCategory: null,
  ...overrides,
});

const open = (locale: 'en' | 'es' = 'en', groupId = GROUP_ID) =>
  renderApp(<GroupActivityContainer groupId={groupId} />, { locale });

const page = (items: object[], nextCursor: string | null = null) => ({
  status: 200,
  body: { items, nextCursor },
});

const routes = (extra: Record<string, object | object[]> = {}) => ({
  [GET_GROUP]: { status: 200, body: group },
  ...extra,
});

describe('GroupActivityContainer', () => {
  it('lists entries newest first with name, action, kind and date and time (AC-30)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: page([
          entry('e2', {
            action: 'settlement_created',
            subjectType: 'settlement',
            memberId: BEA,
            createdAt: '2026-10-11T13:00:00.000Z',
          }),
          entry('e1'),
        ]),
      }),
    );
    open();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText(/Bea/)).toBeTruthy();
    expect(first.getByText(en.groups.activity.actions.settlement_created)).toBeTruthy();
    expect(first.getByText(en.groups.activity.kinds.settlement)).toBeTruthy();
    expect(first.getByText(formatDateTime('2026-10-11T13:00:00.000Z', 'UTC', 'en'))).toBeTruthy();
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText(/Ana/)).toBeTruthy();
    expect(second.getByText(en.groups.activity.actions.expense_created)).toBeTruthy();
    // A creation shows the action only (AC-36).
    expect(second.queryByText(en.groups.activity.fields.amount)).toBeNull();
  });

  it('appends the next page without repeating an entry and drops the control at the end (AC-31)', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: page([entry('e1')], 'next-1'),
        [SECOND_PAGE]: page(
          [entry('e1'), entry('e0', { memberId: BEA, createdAt: '2026-10-10T12:00:00.000Z' })],
          null,
        ),
      }),
    );
    open();
    await screen.findAllByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: en.groups.activity.loadMore }));

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: en.groups.activity.loadMore })).toBeNull();
    expect(calls.filter((call) => call.path.endsWith('activity?limit=50')).length).toBe(1);
  });

  it('shows no load more control without a cursor (AC-31)', async () => {
    stubApi(routes({ [FIRST_PAGE]: page([entry('e1')]) }));
    open();
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: en.groups.activity.loadMore })).toBeNull();
  });

  it('names a member who left from the former members (AC-32)', async () => {
    stubApi(routes({ [FIRST_PAGE]: page([entry('e1', { memberId: OLD })]) }));
    open();
    expect(await screen.findByText(/Old Pal/)).toBeTruthy();
  });

  it('shows the not-found state to a non-member (AC-33)', async () => {
    stubApi({ [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } } });
    open();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.groups.detail.notFound.back })).toBeTruthy();
  });

  it('shows the not-found state when the page answers 404 (AC-33)', async () => {
    stubApi(routes({ [FIRST_PAGE]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } } }));
    open();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
  });

  it('shows each changed field with both values for an edit, and the old values for a deletion (AC-35, AC-36)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: page([
          entry('e2', {
            action: 'expense_deleted',
            before: expenseSnapshot({ amount: '25000', description: 'Taxi' }),
          }),
          entry('e1', {
            action: 'expense_updated',
            before: expenseSnapshot(),
            after: expenseSnapshot({ amount: '120000' }),
          }),
        ]),
        [CATEGORIES]: {
          status: 200,
          body: [
            {
              id: CAT_FOOD,
              defaultKey: null,
              name: 'Food',
              icon: 'receipt',
              color: 'blue',
              archivedAt: null,
            },
            {
              id: CAT_HOME,
              defaultKey: null,
              name: 'Home',
              icon: 'receipt',
              color: 'blue',
              archivedAt: null,
            },
          ],
        },
      }),
    );
    open();

    const rows = await screen.findAllByRole('listitem');
    const deleted = within(rows[0] as HTMLElement);
    expect(deleted.getByText(money(25000n, 'ARS'))).toBeTruthy();
    expect(deleted.getByText('Taxi')).toBeTruthy();
    const edited = within(rows[1] as HTMLElement);
    expect(edited.getByText(en.groups.activity.fields.amount)).toBeTruthy();
    expect(edited.getByText(money(100000n, 'ARS'))).toBeTruthy();
    expect(edited.getByText(money(120000n, 'ARS'))).toBeTruthy();
    expect(edited.queryByText(en.groups.activity.fields.description)).toBeNull();
  });

  it('renders markup in names and descriptions as literal text and creates no element (AC-30, AC-35)', async () => {
    stubApi({
      [GET_GROUP]: {
        status: 200,
        body: { ...group, members: [member(ANA, XSS, 'admin'), member(BEA, 'Bea')] },
      },
      [FIRST_PAGE]: page([
        entry('e1', {
          action: 'expense_deleted',
          before: expenseSnapshot({ description: XSS }),
        }),
      ]),
      [CATEGORIES]: { status: 200, body: [] },
    });
    const { container } = open();

    await screen.findAllByRole('listitem');
    expect(screen.getAllByText(new RegExp(XSS.replaceAll(/[()]/g, '\\$&'))).length).toBeGreaterThan(
      0,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('makes 2 requests on load and requests the categories once only when needed (NFR-02, D6)', async () => {
    const withoutCategory = stubApi(routes({ [FIRST_PAGE]: page([entry('e1')]) }));
    open();
    await screen.findAllByRole('listitem');
    expect(withoutCategory.calls.map((call) => call.path).sort()).toEqual(
      [`/groups/${GROUP_ID}`, `/groups/${GROUP_ID}/activity?limit=50`].sort(),
    );
    document.body.innerHTML = '';

    const withCategory = stubApi(
      routes({
        [FIRST_PAGE]: page([
          entry('e1', {
            action: 'expense_updated',
            before: expenseSnapshot(),
            after: expenseSnapshot({ categoryId: CAT_HOME }),
          }),
        ]),
        [CATEGORIES]: {
          status: 200,
          body: [
            {
              id: CAT_FOOD,
              defaultKey: null,
              name: 'Food',
              icon: 'receipt',
              color: 'blue',
              archivedAt: null,
            },
            {
              id: CAT_HOME,
              defaultKey: null,
              name: 'Home',
              icon: 'receipt',
              color: 'blue',
              archivedAt: null,
            },
          ],
        },
      }),
    );
    open();
    expect(await screen.findByText('Home')).toBeTruthy();
    expect(screen.getByText('Food')).toBeTruthy();
    expect(withCategory.calls.filter((call) => call.path.endsWith('/categories'))).toHaveLength(1);
    expect(withCategory.calls).toHaveLength(3);
  });

  it('renders Spanish with catalog strings and dates in the time zone (AC-37)', async () => {
    stubApi(routes({ [FIRST_PAGE]: page([entry('e1')]) }));
    open('es');
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(screen.getByText(es.groups.activity.title)).toBeTruthy();
    expect(within(row).getByText(es.groups.activity.actions.expense_created)).toBeTruthy();
    expect(
      within(row).getByText(formatDateTime('2026-10-11T12:00:00.000Z', 'UTC', 'es')),
    ).toBeTruthy();
  });

  it('shows the empty state when there is no activity', async () => {
    stubApi(routes({ [FIRST_PAGE]: page([]) }));
    open();
    expect(await screen.findByText(en.groups.activity.emptyTitle)).toBeTruthy();
  });

  it('sends the user to sign-in on a 401 (AC-33)', async () => {
    stubApi({
      [GET_GROUP]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      [FIRST_PAGE]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = open();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('shows the load-failed state with retry on any other error', async () => {
    const { calls } = stubApi(routes({ [FIRST_PAGE]: [{ status: 500 }, page([entry('e1')])] }));
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('activity?limit=50')).length).toBe(2);
  });

  it('keeps the entries and offers retry when loading more fails', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: page([entry('e1')], 'next-1'),
        [SECOND_PAGE]: [{ status: 500 }, page([entry('e0')])],
      }),
    );
    open();
    await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: en.groups.activity.loadMore }));

    expect(await screen.findByText(en.groups.activity.loadMoreFailed)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
  });

  it('keeps the neutral text and does not retry when the category request fails', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: page([
          entry('e1', {
            action: 'expense_updated',
            before: expenseSnapshot(),
            after: expenseSnapshot({ categoryId: CAT_HOME }),
          }),
        ]),
        [CATEGORIES]: { status: 500 },
      }),
    );
    open();

    await waitFor(() => {
      expect(calls.some((call) => call.path.endsWith('/categories'))).toBe(true);
    });
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(within(row).getAllByText(en.groups.activity.neutralCategory)).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.filter((call) => call.path.endsWith('/categories'))).toHaveLength(1);
  });

  it('shows not-found with no request for a malformed group id', async () => {
    const { calls } = stubApi({});
    open('en', 'not-a-uuid');
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
