// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupBalancesContainer } from '../src/features/groups/balances/group-balances-container';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const GET_BALANCES = `GET /groups/${GROUP_ID}/balances`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';

const member = (id: string, displayName: string | null) => ({
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
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [member(ANA, 'Ana'), member(BRUNO, 'Bruno'), member(CARLA, null)],
  formerMembers: [],
};

// The API sends Bruno before Ana: the screen must still show the caller first.
const owing = {
  ARS: {
    members: [
      { memberId: BRUNO, balance: '-150000' },
      { memberId: ANA, balance: '150000' },
      { memberId: CARLA, balance: '0' },
    ],
    payments: [{ fromMemberId: BRUNO, toMemberId: ANA, amount: '150000' }],
  },
  USD: {
    members: [
      { memberId: ANA, balance: '-1000' },
      { memberId: BRUNO, balance: '1000' },
      { memberId: CARLA, balance: '0' },
    ],
    payments: [{ fromMemberId: ANA, toMemberId: BRUNO, amount: '1000' }],
  },
};

const allEven = {
  ARS: {
    members: [
      { memberId: ANA, balance: '0' },
      { memberId: BRUNO, balance: '0' },
    ],
    payments: [],
  },
  USD: owing.USD,
};

const settledAfter = {
  ARS: {
    members: [
      { memberId: ANA, balance: '0' },
      { memberId: BRUNO, balance: '0' },
    ],
    payments: [],
  },
  USD: owing.USD,
};

const accountList = {
  items: [],
  availableTotals: { ARS: '0', USD: '0' },
  netWorthTotals: { ARS: '0', USD: '0' },
  debtTotals: { ARS: '0', USD: '0' },
  creditCardCount: 0,
  total: 0,
  limit: 100,
  offset: 0,
};

const recorded = {
  id: '88888888-8888-4888-8888-888888888888',
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

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupBalancesContainer groupId={GROUP_ID} />, { locale });

const section = (currency: string) => {
  const found = screen.getByRole('region', { name: new RegExp(currency) });
  return found;
};

const t = en.groups.balances;
// The formatter separates amount and currency with a no-break space; the DOM matcher collapses it.
const money = (minor: bigint, currency: 'ARS' | 'USD') =>
  formatMoney(minor, currency, 'en').replace(/\s/g, ' ');

describe('GroupBalancesContainer', () => {
  it('shows each balance in ARS and in USD separately, caller first', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    const ars = within(section('ARS'));
    const rows = ars.getAllByRole('listitem').filter((li) => li.hasAttribute('data-member-row'));
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Ana');
    expect(rows[0]?.textContent).toContain(formatMoney(150000n, 'ARS', 'en'));
    expect(rows[1]?.textContent).toContain('Bruno');
    const usd = within(section('USD'));
    const usdRows = usd.getAllByRole('listitem').filter((li) => li.hasAttribute('data-member-row'));
    expect(usdRows[0]?.textContent).toContain('Ana');
    expect(usdRows[0]?.textContent).toContain(formatMoney(1000n, 'USD', 'en'));
  });

  it('says owes and is owed with text', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    const rows = within(section('ARS'))
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-member-row'));
    expect(within(rows[0] as HTMLElement).getByText(t.owed)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(t.owes)).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText(t.even)).toBeTruthy();
    // The unnamed member uses the shared copy.
    expect(rows[2]?.textContent).toContain(en.groups.detail.unnamed);
  });

  it('lists each suggested payment as payer, payee and amount', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    const amount = money(150000n, 'ARS');
    expect(
      within(section('ARS')).getByText(
        t.payment.replace('{payer}', 'Bruno').replace('{payee}', 'Ana').replace('{amount}', amount),
      ),
    ).toBeTruthy();
    expect(within(section('USD')).getAllByRole('button', { name: t.record })).toHaveLength(1);
  });

  it('shows the settled state and no payments when every balance is 0', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: allEven },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    const ars = within(section('ARS'));
    expect(ars.getByText(t.settled)).toBeTruthy();
    expect(ars.queryByRole('button', { name: t.record })).toBeNull();
    expect(within(section('USD')).queryByText(t.settled)).toBeNull();
  });

  it('opens the form prefilled from a suggested payment', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
      [ACCOUNTS]: { status: 200, body: accountList },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    await userEvent.click(within(section('ARS')).getByRole('button', { name: t.record }));

    const f = en.groups.settlement.fields;
    expect(screen.getByLabelText<HTMLSelectElement>(f.from).value).toBe(BRUNO);
    expect(screen.getByLabelText<HTMLSelectElement>(f.to).value).toBe(ANA);
    expect(screen.getByLabelText<HTMLInputElement>(f.amount).value).toBe('1500');
  });

  it('opens an empty form from "Record a payment" and closes it on cancel', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    await userEvent.click(screen.getByRole('button', { name: t.recordPayment }));
    expect(screen.getByLabelText<HTMLInputElement>(en.groups.settlement.fields.amount).value).toBe(
      '',
    );
    await userEvent.click(screen.getByRole('button', { name: en.groups.settlement.cancel }));
    expect(screen.queryByLabelText(en.groups.settlement.fields.amount)).toBeNull();
  });

  it('links to the history and to the consolidation', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    expect(screen.getByRole('link', { name: t.historyLink }).getAttribute('href')).toContain(
      `/groups/${GROUP_ID}/settlements`,
    );
    expect(screen.getByRole('link', { name: t.consolidateLink }).getAttribute('href')).toContain(
      `/groups/${GROUP_ID}/settlements/consolidate`,
    );
  });

  it('shows the not-found state with a link back for a group the user is not in', async () => {
    stubApi({
      [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
      [GET_BALANCES]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
    });
    open();

    expect(await screen.findByText(t.notFound.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.notFound.back }).getAttribute('href')).toContain(
      '/groups',
    );
  });

  it('loads with exactly two requests', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(
      [GET_GROUP, GET_BALANCES].sort(),
    );
  });

  it('reloads only the balances after a recorded settlement and shows the new numbers', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: [
        { status: 200, body: owing },
        { status: 200, body: settledAfter },
      ],
      [ACCOUNTS]: { status: 200, body: accountList },
      [`POST /groups/${GROUP_ID}/settlements`]: { status: 201, body: recorded },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    await userEvent.click(within(section('ARS')).getByRole('button', { name: t.record }));
    await userEvent.click(screen.getByRole('button', { name: en.groups.settlement.submit }));

    await waitFor(() => {
      expect(within(section('ARS')).getByText(t.settled)).toBeTruthy();
    });
    expect(screen.queryByLabelText(en.groups.settlement.fields.amount)).toBeNull();
    const after = calls.slice(calls.findIndex((call) => call.method === 'POST') + 1);
    expect(after.map((call) => `${call.method} ${call.path}`)).toEqual([GET_BALANCES]);
  });

  it('keeps the old balances and offers a retry when the reload fails', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: [
        { status: 200, body: owing },
        { status: 500 },
        { status: 200, body: settledAfter },
      ],
      [ACCOUNTS]: { status: 200, body: accountList },
      [`POST /groups/${GROUP_ID}/settlements`]: { status: 201, body: recorded },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    await userEvent.click(within(section('ARS')).getByRole('button', { name: t.record }));
    await userEvent.click(screen.getByRole('button', { name: en.groups.settlement.submit }));

    await screen.findByRole('alert');
    expect(
      within(section('ARS')).getAllByText(money(150000n, 'ARS'), { exact: false }).length,
    ).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    await waitFor(() => {
      expect(within(section('ARS')).getByText(t.settled)).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the not-found state when the group disappears during the reload', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: [
        { status: 200, body: owing },
        { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
      ],
      [ACCOUNTS]: { status: 200, body: accountList },
      [`POST /groups/${GROUP_ID}/settlements`]: { status: 201, body: recorded },
    });
    open();

    await screen.findByRole('heading', { name: 'Flatmates' });
    await userEvent.click(within(section('ARS')).getByRole('button', { name: t.record }));
    await userEvent.click(screen.getByRole('button', { name: en.groups.settlement.submit }));

    expect(await screen.findByText(t.notFound.title)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Flatmates' })).toBeNull();
  });

  it('shows the retry on a load error and loads again', async () => {
    const { calls } = stubApi({
      [GET_GROUP]: [{ status: 500 }, { status: 200, body: detail }],
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open();

    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    await screen.findByRole('heading', { name: 'Flatmates' });
    expect(calls.filter((call) => call.path === `/groups/${GROUP_ID}`)).toHaveLength(2);
  });

  it('renders in Spanish', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: detail },
      [GET_BALANCES]: { status: 200, body: owing },
    });
    open('es');

    await screen.findByRole('heading', { name: 'Flatmates' });
    expect(screen.getByRole('button', { name: es.groups.balances.recordPayment })).toBeTruthy();
    expect(screen.getByRole('link', { name: es.groups.balances.historyLink })).toBeTruthy();
    expect(within(section('ARS')).getByText(es.groups.balances.owes)).toBeTruthy();
    expect(es.groups.balances.owes).not.toBe(en.groups.balances.owes);
  });
});
