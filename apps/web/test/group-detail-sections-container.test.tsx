// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupDetailContainer } from '../src/features/groups/containers/group-detail-container';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const FOOD = '66666666-6666-4666-8666-666666666661';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const GET_BALANCES = `GET /groups/${GROUP_ID}/balances`;
const GET_RECENT = `GET /groups/${GROUP_ID}/expenses?limit=5`;
const GET_OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const SETTLEMENTS = `POST /groups/${GROUP_ID}/settlements`;
const RECORD_BUTTON = /Record payment from Bruno to Ana/;
const LOAD_CALLS = [GET_BALANCES, GET_GROUP, GET_OPTIONS, GET_RECENT].sort();

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  isGhost: false,
  role: 'member',
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const detail = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [member(ANA, 'Ana'), member(BRUNO, 'Bruno')],
  formerMembers: [],
};

const evenUsd = {
  members: [
    { memberId: ANA, balance: '0' },
    { memberId: BRUNO, balance: '0' },
  ],
  payments: [],
};
const BRUNO_OWES = {
  ARS: {
    members: [
      { memberId: BRUNO, balance: '-150000' },
      { memberId: ANA, balance: '150000' },
    ],
    payments: [{ fromMemberId: BRUNO, toMemberId: ANA, amount: '150000' }],
  },
  USD: evenUsd,
};
const SETTLED = { ARS: evenUsd, USD: evenUsd };

const OPTIONS_BODY = {
  selfMemberId: ANA,
  members: [
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: BRUNO, displayName: 'Bruno', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
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

const recentExpense = (n: number) => ({
  id: `88888888-8888-4888-8888-88888888000${String(n)}`,
  groupId: GROUP_ID,
  payerMemberId: BRUNO,
  createdByMemberId: BRUNO,
  amount: '1500050',
  currency: 'ARS',
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId: FOOD,
  description: `Expense ${String(n)}`,
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  shares: [
    { memberId: ANA, amount: '750025' },
    { memberId: BRUNO, amount: '750025' },
  ],
  version: 1,
});
const page = (...numbers: number[]) => ({
  status: 200,
  body: { items: numbers.map(recentExpense), nextCursor: null },
});

const RECORDED = {
  id: '99999999-9999-4999-8999-999999999999',
  groupId: GROUP_ID,
  fromMemberId: BRUNO,
  toMemberId: ANA,
  currency: 'ARS',
  amount: '150000',
  legs: [],
  occurredAt: '2026-10-11T12:00:00.000Z',
  createdByMemberId: ANA,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-11T12:00:00.000Z',
  version: 1,
};
const ACCOUNT_LIST = {
  items: [],
  availableTotals: { ARS: '0', USD: '0' },
  netWorthTotals: { ARS: '0', USD: '0' },
  debtTotals: { ARS: '0', USD: '0' },
  creditCardCount: 0,
  total: 0,
  limit: 100,
  offset: 0,
};

type Routes = Parameters<typeof stubApi>[0];
const routes = (overrides: Routes = {}): Routes => ({
  [GET_GROUP]: { status: 200, body: detail },
  [GET_BALANCES]: { status: 200, body: BRUNO_OWES },
  [GET_RECENT]: page(2, 1),
  [GET_OPTIONS]: { status: 200, body: OPTIONS_BODY },
  [ACCOUNTS]: { status: 200, body: ACCOUNT_LIST },
  ...overrides,
});

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupDetailContainer groupId={GROUP_ID} />, { locale });

const sectionOf = async (title: string) => {
  const heading = await screen.findByRole('heading', { name: title });
  const section = heading.closest('section');
  if (!section) throw new Error(`No section for ${title}`);
  return section;
};

describe('GroupDetailContainer suggested payments and recent expenses', () => {
  it('shows the suggested payments and the recent expenses on the detail', async () => {
    stubApi(routes());
    open();

    expect(await screen.findByRole('button', { name: RECORD_BUTTON })).toBeTruthy();
    expect(screen.getByText('Bruno pays Ana 1,500.00 ARS')).toBeTruthy();
    expect(await screen.findByText('Expense 2')).toBeTruthy();
    expect(screen.getByText('Expense 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: en.groups.detail.seeAll }).getAttribute('href')).toBe(
      `/en/groups/${GROUP_ID}/expenses`,
    );
  });

  it('issues the group, balances, list and options calls once each', async () => {
    const { calls } = stubApi(routes());
    open();
    await screen.findByText('Expense 2');

    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(LOAD_CALLS);
  });

  it('opens the settlement form prefilled when Record is pressed', async () => {
    stubApi(routes());
    open();

    await userEvent.click(await screen.findByRole('button', { name: RECORD_BUTTON }));

    const amount = await screen.findByLabelText(en.groups.settlement.fields.amount);
    expect((amount as HTMLInputElement).value).toContain('1500');
    // The direction line of the form names the payer, the payee, the amount and its currency.
    expect(screen.getByText('Bruno pays Ana 1,500.00 ARS', { selector: 'p' })).toBeTruthy();
  });

  it('closes the form and reloads only the balances after a payment is recorded', async () => {
    const { calls } = stubApi(
      routes({
        [GET_BALANCES]: [
          { status: 200, body: BRUNO_OWES },
          { status: 200, body: SETTLED },
        ],
        [SETTLEMENTS]: { status: 201, body: RECORDED },
      }),
    );
    open();
    await screen.findByText('Expense 2');
    expect(await screen.findByText('You are owed 1,500.00 ARS')).toBeTruthy();

    await userEvent.click(await screen.findByRole('button', { name: RECORD_BUTTON }));
    await userEvent.click(await screen.findByRole('button', { name: en.groups.settlement.submit }));

    await waitFor(() => {
      expect(screen.getByText(en.groups.detail.allSettled)).toBeTruthy();
    });
    expect(screen.queryByLabelText(en.groups.settlement.fields.amount)).toBeNull();
    // The own-balance summary follows the reloaded balances (AC-04).
    expect(screen.getByText('You are settled up in ARS')).toBeTruthy();
    expect(screen.queryByText('You are owed 1,500.00 ARS')).toBeNull();
    const after = calls.slice(calls.findIndex((call) => call.method === 'POST') + 1);
    expect(after.map((call) => `${call.method} ${call.path}`)).toEqual([GET_BALANCES]);
  });

  it('keeps the form open and does not reload the balances when recording fails (error)', async () => {
    const { calls } = stubApi(routes({ [SETTLEMENTS]: { status: 500 } }));
    open();
    await screen.findByText('Expense 2');

    await userEvent.click(await screen.findByRole('button', { name: RECORD_BUTTON }));
    await userEvent.click(await screen.findByRole('button', { name: en.groups.settlement.submit }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText(en.groups.settlement.fields.amount)).toBeTruthy();
    expect(calls.filter((call) => call.path === GET_BALANCES.slice(4))).toHaveLength(1);
  });

  it('shows the settled message when no currency has a payment', async () => {
    stubApi(routes({ [GET_BALANCES]: { status: 200, body: SETTLED } }));
    open();

    expect(await screen.findByText(en.groups.detail.allSettled)).toBeTruthy();
    expect(screen.queryByRole('button', { name: RECORD_BUTTON })).toBeNull();
  });

  it('shows the empty message and the link when the group has no expenses', async () => {
    stubApi(routes({ [GET_RECENT]: page() }));
    open();

    expect(await screen.findByText(en.groups.detail.recentEmpty)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en.groups.detail.recentEmptyLink }).getAttribute('href'),
    ).toBe(`/en/groups/${GROUP_ID}/expenses`);
  });

  it('shows a retry in the suggested payments only when the balances call fails (error)', async () => {
    stubApi(routes({ [GET_BALANCES]: { status: 500 } }));
    open();

    const section = await sectionOf(en.groups.detail.suggestedTitle);
    expect(await within(section).findByText(en.groups.detail.sectionFailed)).toBeTruthy();
    expect(await screen.findByText('Expense 2')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('shows a retry in the recent expenses only when the expenses call fails (error)', async () => {
    stubApi(routes({ [GET_RECENT]: { status: 500 } }));
    open();

    const section = await sectionOf(en.groups.detail.recentTitle);
    expect(await within(section).findByText(en.groups.detail.sectionFailed)).toBeTruthy();
    expect(await screen.findByRole('button', { name: RECORD_BUTTON })).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('retrying the failed expenses section loads it again and leaves the balances alone', async () => {
    const { calls } = stubApi(routes({ [GET_RECENT]: [{ status: 500 }, page(1)] }));
    open();
    const section = await sectionOf(en.groups.detail.recentTitle);

    await userEvent.click(await within(section).findByRole('button', { name: en.app.retry }));

    expect(await screen.findByText('Expense 1')).toBeTruthy();
    expect(calls.filter((call) => call.path === GET_BALANCES.slice(4))).toHaveLength(1);
  });

  it('shows the members and at most 5 skeleton rows while the expenses call is held pending', async () => {
    const { fetch } = stubApi(routes());
    const answer = fetch.getMockImplementation();
    if (answer === undefined) throw new Error('stubApi installs a fetch implementation');
    // The expenses list never answers: everything else does.
    fetch.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith(GET_RECENT.slice(4))
        ? new Promise<Response>(() => undefined)
        : answer(url, init),
    );
    open();

    expect(await screen.findByText('Bruno')).toBeTruthy();
    const section = await sectionOf(en.groups.detail.recentTitle);
    const skeletons = section.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.length).toBeLessThanOrEqual(5);
    expect(screen.queryByText('Expense 2')).toBeNull();
  });

  it('issues the four load calls without waiting for any answer to arrive', async () => {
    const { fetch } = stubApi(routes());
    const issued: string[] = [];
    // Nothing ever answers, so every call seen here was started without waiting for another.
    fetch.mockImplementation((url: string, init?: RequestInit) => {
      issued.push(`${init?.method ?? 'GET'} ${url.slice(API_ORIGIN.length)}`);
      return new Promise<Response>(() => undefined);
    });
    open();

    await waitFor(() => {
      expect([...issued].sort()).toEqual(LOAD_CALLS);
    });
  });

  it('shows at most 5 rows, in the order the API sent them', async () => {
    stubApi(routes({ [GET_RECENT]: page(6, 5, 4, 3, 2, 1) }));
    open();

    const section = await sectionOf(en.groups.detail.recentTitle);
    await within(section).findByText('Expense 6');
    const shown = within(section)
      .getAllByRole('listitem')
      .map((row) => /Expense \d/.exec(row.textContent)?.[0]);
    expect(shown).toEqual(['Expense 6', 'Expense 5', 'Expense 4', 'Expense 3', 'Expense 2']);
  });

  it('retrying the failed suggested payments loads the balances again and leaves the expenses alone', async () => {
    const { calls } = stubApi(
      routes({ [GET_BALANCES]: [{ status: 500 }, { status: 200, body: BRUNO_OWES }] }),
    );
    open();
    const section = await sectionOf(en.groups.detail.suggestedTitle);
    expect(await screen.findByText(en.groups.detail.sectionFailed)).toBeTruthy();
    // The own-balance summary falls back to its unavailable text while the balances are missing.
    expect(screen.getByText(en.groups.detail.ownBalance.unavailable)).toBeTruthy();

    await userEvent.click(await within(section).findByRole('button', { name: en.app.retry }));

    expect(await screen.findByRole('button', { name: RECORD_BUTTON })).toBeTruthy();
    expect(screen.getByText('You are owed 1,500.00 ARS')).toBeTruthy();
    expect(calls.filter((call) => call.path === GET_RECENT.slice(4))).toHaveLength(1);
  });

  it.each([
    ['balances', GET_BALANCES],
    ['expenses', GET_RECENT],
    ['options', GET_OPTIONS],
  ])('a 404 on the %s call shows the not-found view and neither section', async (_name, key) => {
    stubApi(routes({ [key]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    open();

    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(screen.queryByText(en.groups.detail.suggestedTitle)).toBeNull();
    expect(screen.queryByText(en.groups.detail.recentTitle)).toBeNull();
  });

  it.each([
    ['balances', GET_BALANCES],
    ['expenses', GET_RECENT],
    ['options', GET_OPTIONS],
  ])('a 401 on the %s call goes to sign-in', async (_name, key) => {
    stubApi(routes({ [key]: { status: 401, body: { code: 'UNAUTHENTICATED' } } }));
    const { router } = open();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('shows a retry in the suggested section when the reload after recording fails (error)', async () => {
    stubApi(
      routes({
        [GET_BALANCES]: [{ status: 200, body: BRUNO_OWES }, { status: 500 }],
        [SETTLEMENTS]: { status: 201, body: RECORDED },
      }),
    );
    open();
    await screen.findByText('Expense 2');

    await userEvent.click(await screen.findByRole('button', { name: RECORD_BUTTON }));
    await userEvent.click(await screen.findByRole('button', { name: en.groups.settlement.submit }));

    expect(await screen.findByText(en.groups.detail.sectionFailed)).toBeTruthy();
    expect(screen.queryByLabelText(en.groups.settlement.fields.amount)).toBeNull();
  });

  it('renders both sections in Spanish', async () => {
    stubApi(routes());
    open('es');

    expect(
      await screen.findByRole('heading', { name: es.groups.detail.suggestedTitle }),
    ).toBeTruthy();
    expect(await screen.findByRole('heading', { name: es.groups.detail.recentTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: es.groups.detail.seeAll })).toBeTruthy();
    // Amounts and dates use the Spanish format: dot for thousands, comma for decimals, day first.
    expect(await screen.findByText(/Bruno le paga a Ana 1\.500,00/)).toBeTruthy();
    expect(screen.getAllByText(/15\.000,50/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 oct/).length).toBeGreaterThan(0);
  });
});
