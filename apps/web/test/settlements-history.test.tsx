// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SettlementsHistoryContainer } from '../src/features/groups/settlements-history/settlements-history-container';
import { formatDateTime, formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '77777777-7777-4777-8777-777777777771';
const BEA = '77777777-7777-4777-8777-777777777772';
const OLD = '77777777-7777-4777-8777-777777777773';
const money = (value: bigint, currency: 'ARS' | 'USD'): string =>
  formatMoney(value, currency, 'en').replaceAll(String.fromCharCode(0xa0), ' ');
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const FIRST_PAGE = `GET /groups/${GROUP_ID}/settlements?limit=50`;
const SECOND_PAGE = `GET /groups/${GROUP_ID}/settlements?limit=50&cursor=next-1`;

const group = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [
    {
      id: ANA,
      displayName: 'Ana',
      isGhost: false,
      role: 'admin',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: BEA,
      displayName: 'Bea',
      isGhost: false,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  formerMembers: [{ id: OLD, displayName: 'Old Pal', leftAt: '2026-10-03T00:00:00.000Z' }],
};

const settlement = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  groupId: GROUP_ID,
  fromMemberId: ANA,
  toMemberId: BEA,
  currency: 'ARS',
  amount: '150050',
  legs: [{ currency: 'ARS', amount: '150050' }],
  occurredAt: '2026-10-05T15:30:00.000Z',
  createdByMemberId: ANA,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  version: 1,
  ...overrides,
});

const S1 = '88888888-8888-4888-8888-888888888801';
const S2 = '88888888-8888-4888-8888-888888888802';
const S3 = '88888888-8888-4888-8888-888888888803';

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<SettlementsHistoryContainer groupId={GROUP_ID} />, { locale });

const routes = (extra: Record<string, object | object[]> = {}) => ({
  [GET_GROUP]: { status: 200, body: group },
  ...extra,
});

describe('SettlementsHistoryContainer', () => {
  it('lists parties, amount, date and the consolidated marker in the given order (AC-18)', async () => {
    const consolidated = settlement(S2, {
      fromMemberId: BEA,
      toMemberId: ANA,
      currency: 'USD',
      amount: '2500',
      rate: '12345678',
      rateSource: 'manual',
      rateType: 'blue',
    });
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: {
          status: 200,
          body: { items: [consolidated, settlement(S1)], nextCursor: null },
        },
      }),
    );
    open();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(money(2500n, 'USD'))).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/Bea/)).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByText(en.groups.settlements.consolidated),
    ).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(money(150050n, 'ARS'))).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).getByText(
        formatDateTime('2026-10-05T15:30:00.000Z', 'UTC', 'en'),
      ),
    ).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).queryByText(en.groups.settlements.consolidated),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: en.groups.settlements.loadMore })).toBeNull();
    // NFR-02: the group (for names) and the first page.
    expect(calls.map((call) => call.path).sort()).toEqual(
      [`/groups/${GROUP_ID}`, `/groups/${GROUP_ID}/settlements?limit=50`].sort(),
    );
  });

  it('appends the next page without repeating a settlement and hides the button at the end (AC-19)', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: { status: 200, body: { items: [settlement(S1)], nextCursor: 'next-1' } },
        [SECOND_PAGE]: {
          status: 200,
          body: { items: [settlement(S1), settlement(S3, { amount: '700' })], nextCursor: null },
        },
      }),
    );
    open();
    await screen.findAllByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: en.groups.settlements.loadMore }));

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(screen.getAllByText(money(150050n, 'ARS'))).toHaveLength(1);
    expect(screen.getByText(money(700n, 'ARS'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.groups.settlements.loadMore })).toBeNull();
    // Earlier pages are never fetched again.
    expect(calls.filter((call) => call.path.endsWith('limit=50')).length).toBe(1);
  });

  it('names a former member from formerMembers (AC-18)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: {
          status: 200,
          body: { items: [settlement(S1, { toMemberId: OLD })], nextCursor: null },
        },
      }),
    );
    open();

    expect(await screen.findByText(/Old Pal/)).toBeTruthy();
  });

  it('shows the empty state with a link to the balances (AC-18)', async () => {
    stubApi(routes({ [FIRST_PAGE]: { status: 200, body: { items: [], nextCursor: null } } }));
    open();

    expect(await screen.findByText(en.groups.settlements.emptyTitle)).toBeTruthy();
    const link = screen.getByRole('link', { name: en.groups.settlements.emptyAction });
    expect(link.getAttribute('href')).toContain(`/groups/${GROUP_ID}/balances`);
  });

  it('keeps the rows and offers a retry when loading more fails', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: { status: 200, body: { items: [settlement(S1)], nextCursor: 'next-1' } },
        [SECOND_PAGE]: [
          { status: 500 },
          { status: 200, body: { items: [settlement(S3, { amount: '700' })], nextCursor: null } },
        ],
      }),
    );
    open();
    await screen.findAllByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: en.groups.settlements.loadMore }));

    expect(await screen.findByText(en.groups.settlements.loadMoreFailed)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(screen.queryByText(en.groups.settlements.loadMoreFailed)).toBeNull();
  });

  it('shows the retry on a load error and loads again', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: [
          { status: 500 },
          { status: 200, body: { items: [settlement(S1)], nextCursor: null } },
        ],
      }),
    );
    open();

    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));

    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('limit=50')).length).toBe(2);
  });

  it('shows the not-found state with a link back (AC-23)', async () => {
    stubApi({ [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } } });
    open();

    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.groups.detail.notFound.back })).toBeTruthy();
  });

  it('renders Spanish and English strings (AC-22)', async () => {
    stubApi(routes({ [FIRST_PAGE]: { status: 200, body: { items: [], nextCursor: null } } }));
    open('es');
    expect(await screen.findByText(es.groups.settlements.emptyTitle)).toBeTruthy();
    expect(screen.getByText(es.groups.settlements.title)).toBeTruthy();
  });
});
