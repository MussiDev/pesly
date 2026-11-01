// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettlementFormContainer } from '../src/features/groups/settlement-form/settlement-form-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';
import { pickSegment } from './support/segmented';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const ACC_ARS = '77777777-7777-4777-8777-777777777771';
const ACC_ARS_2 = '77777777-7777-4777-8777-777777777772';
const ACC_USD = '77777777-7777-4777-8777-777777777773';
const ACC_CARD = '77777777-7777-4777-8777-777777777774';
const SETTLE = `POST /groups/${GROUP_ID}/settlements`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const NBSP = String.fromCharCode(0xa0);

const member = (id: string, displayName: string | null, isGhost = false) => ({
  id,
  displayName,
  isGhost,
  role: 'member' as const,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const members = [member(ANA, 'Ana'), member(BRUNO, 'Bruno'), member(CARLA, 'Carla', true)];

const account = (id: string, name: string, currency: 'ARS' | 'USD', type = 'cash') => ({
  id,
  name,
  type,
  currency,
  openingBalance: '0',
  balance: '0',
  includeInAvailable: true,
  archived: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const accountList = {
  items: [
    account(ACC_ARS, 'Wallet', 'ARS'),
    account(ACC_ARS_2, 'Bank', 'ARS', 'bank_account'),
    account(ACC_USD, 'Dollars', 'USD'),
    account(ACC_CARD, 'Visa', 'ARS', 'credit_card'),
  ],
  availableTotals: { ARS: '0', USD: '0' },
  netWorthTotals: { ARS: '0', USD: '0' },
  debtTotals: { ARS: '0', USD: '0' },
  creditCardCount: 1,
  total: 4,
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

const suggestion = {
  fromMemberId: BRUNO,
  toMemberId: ANA,
  currency: 'ARS' as const,
  amount: 150000n,
};

interface OpenOptions {
  initial?: typeof suggestion | null;
  locale?: 'en' | 'es';
}

function open({ initial = suggestion, locale = 'en' }: OpenOptions = {}) {
  const onRecorded = vi.fn();
  const onCancel = vi.fn();
  renderApp(
    <SettlementFormContainer
      groupId={GROUP_ID}
      selfMemberId={ANA}
      members={members}
      initial={initial}
      onRecorded={onRecorded}
      onCancel={onCancel}
    />,
    { locale },
  );
  return { onRecorded, onCancel };
}

const f = en.groups.settlement.fields;
const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const post = (calls: { method: string; body: unknown }[]) =>
  calls.filter((call) => call.method === 'POST');
const submit = () => screen.getByRole('button', { name: en.groups.settlement.submit });

describe('single settlement form', () => {
  it('records a suggested payment with the chosen account and tells the page to reload', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 201, body: recorded },
    });
    const { onRecorded } = open();

    expect(field(f.from).value).toBe(BRUNO);
    expect(field(f.to).value).toBe(ANA);
    expect(field(f.amount).value).toBe('1500');
    await screen.findByRole('option', { name: 'Wallet' });
    await userEvent.selectOptions(field(f.account), ACC_ARS);
    await userEvent.click(submit());

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
    const [sent] = post(calls);
    expect(sent?.body).toMatchObject({
      kind: 'single',
      fromMemberId: BRUNO,
      toMemberId: ANA,
      currency: 'ARS',
      amount: '150000',
      accountId: ACC_ARS,
    });
    expect(post(calls)).toHaveLength(1);
  });

  it('records a payment from scratch', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 201, body: recorded },
    });
    const { onRecorded } = open({ initial: null });

    await userEvent.selectOptions(field(f.from), ANA);
    await userEvent.selectOptions(field(f.to), BRUNO);
    await userEvent.type(field(f.amount), '20.5');
    await userEvent.click(submit());

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
    expect(post(calls)[0]?.body).toMatchObject({ amount: '2050', fromMemberId: ANA });
  });

  it.each(['', '0', '-5', 'abc'])(
    'shows a field error for the amount "%s" and sends nothing',
    async (text) => {
      const { calls } = stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
      open();
      const amount = field(f.amount);
      await userEvent.clear(amount);
      if (text !== '') await userEvent.type(amount, text);

      await userEvent.click(submit());

      expect(post(calls)).toHaveLength(0);
      await waitFor(() => {
        expect(field(f.amount).getAttribute('aria-invalid')).toBe('true');
      });
      expect(document.activeElement).toBe(field(f.amount));
    },
  );

  it('refuses the same member on both sides before any request', async () => {
    const { calls } = stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    open();
    await userEvent.selectOptions(field(f.to), BRUNO);

    await userEvent.click(submit());

    expect(post(calls)).toHaveLength(0);
    expect(await screen.findByText(en.groups.settlement.errors.sameMember)).toBeTruthy();
  });

  it('keeps the form and every value when the API refuses the members', async () => {
    stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 400, body: { code: 'GROUP_SETTLEMENT_MEMBER_INVALID' } },
    });
    const { onRecorded } = open();
    await userEvent.clear(field(f.amount));
    await userEvent.type(field(f.amount), '99');

    await userEvent.click(submit());

    expect(await screen.findByText(en.errors.groupSettlementMemberInvalid)).toBeTruthy();
    expect(field(f.amount).value).toBe('99');
    expect(field(f.from).value).toBe(BRUNO);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(submit().hasAttribute('disabled')).toBe(false);
  });

  it('offers only the open accounts of the currency to a party, and sends the chosen id', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 201, body: recorded },
    });
    open();

    await screen.findByRole('option', { name: 'Wallet' });
    const names = Array.from(screen.getByLabelText<HTMLSelectElement>(f.account).options).map(
      (option) => option.textContent,
    );
    expect(names).toEqual([en.groups.settlement.accountNone, 'Wallet', 'Bank']);
    expect(field(f.account).value).toBe('');

    await userEvent.selectOptions(field(f.account), ACC_ARS_2);
    await userEvent.click(submit());
    await waitFor(() => {
      expect(post(calls)).toHaveLength(1);
    });
    expect(post(calls)[0]?.body).toMatchObject({ accountId: ACC_ARS_2 });
  });

  it('shows no account field and requests no accounts when the caller is not a party', async () => {
    const { calls } = stubApi({ [SETTLE]: { status: 201, body: recorded } });
    open({ initial: { fromMemberId: BRUNO, toMemberId: CARLA, currency: 'ARS', amount: 5000n } });

    expect(screen.queryByLabelText(f.account)).toBeNull();
    await userEvent.click(submit());

    await waitFor(() => {
      expect(post(calls)).toHaveLength(1);
    });
    expect(post(calls)[0]?.body).not.toHaveProperty('accountId');
    expect(calls.some((call) => call.path.startsWith('/accounts'))).toBe(false);
  });

  it('refreshes the accounts when the currency changes and drops one in another currency', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 201, body: recorded },
    });
    open();
    await screen.findByRole('option', { name: 'Wallet' });
    await userEvent.selectOptions(field(f.account), ACC_ARS);

    await pickSegment(f.currency, 'USD');

    await screen.findByRole('option', { name: 'Dollars' });
    expect(screen.queryByRole('option', { name: 'Wallet' })).toBeNull();
    expect(field(f.account).value).toBe('');
    await userEvent.click(submit());
    await waitFor(() => {
      expect(post(calls)).toHaveLength(1);
    });
    expect(post(calls)[0]?.body).toMatchObject({ currency: 'USD' });
    expect(post(calls)[0]?.body).not.toHaveProperty('accountId');
    expect(calls.filter((call) => call.path.startsWith('/accounts'))).toHaveLength(1);
  });

  it('says in words who pays whom and follows the values', async () => {
    stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    open();

    expect(document.body.textContent).toContain(`Bruno pays Ana 1,500.00${NBSP}ARS`);

    await userEvent.clear(field(f.amount));
    await userEvent.type(field(f.amount), '20');
    await userEvent.selectOptions(field(f.from), CARLA);
    await pickSegment(f.currency, 'USD');

    expect(document.body.textContent).toContain(`Carla pays Ana 20.00${NBSP}USD`);
  });

  it('sends one request on a double click', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 201, body: recorded },
    });
    const { onRecorded } = open();

    await userEvent.dblClick(submit());

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalled();
    });
    expect(post(calls)).toHaveLength(1);
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('clears only the account when the API refuses it', async () => {
    stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 400, body: { code: 'GROUP_SETTLEMENT_ACCOUNT_INVALID' } },
    });
    open();
    await screen.findByRole('option', { name: 'Wallet' });
    await userEvent.selectOptions(field(f.account), ACC_ARS);

    await userEvent.click(submit());

    expect(await screen.findByText(en.errors.groupSettlementAccountInvalid)).toBeTruthy();
    expect(field(f.account).value).toBe('');
    expect(field(f.amount).value).toBe('1500');
    expect(field(f.from).value).toBe(BRUNO);
    expect(field(f.to).value).toBe(ANA);
  });

  it('offers a retry when the accounts fail and still records without an account', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: [{ status: 500 }, { status: 200, body: accountList }],
      [SETTLE]: { status: 201, body: recorded },
    });
    const { onRecorded } = open();

    const retry = await screen.findByRole('button', { name: en.groups.settlement.accountsRetry });
    await userEvent.click(submit());
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
    expect(post(calls)[0]?.body).not.toHaveProperty('accountId');

    await userEvent.click(retry);
    await screen.findByRole('option', { name: 'Wallet' });
    expect(calls.filter((call) => call.path.startsWith('/accounts'))).toHaveLength(2);
  });

  it('shows the localized pending label on the submit button while the request is in flight', async () => {
    const { fetch } = stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Promise<Response>(() => undefined) : fetch(url, init),
    );
    open();

    await userEvent.click(submit());

    const button = await screen.findByRole('button', { name: en.groups.settlement.pending });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('shows the not-found message on a 404', async () => {
    stubApi({
      [ACCOUNTS]: { status: 200, body: accountList },
      [SETTLE]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    const { onRecorded } = open();

    await userEvent.click(submit());

    expect(await screen.findByText(en.groups.settlement.notFound)).toBeTruthy();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', async () => {
    stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    const { onCancel } = open();
    await userEvent.click(screen.getByRole('button', { name: en.groups.settlement.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('names an unnamed member with the shared copy', () => {
    stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    const { container } = renderApp(
      <SettlementFormContainer
        groupId={GROUP_ID}
        selfMemberId={ANA}
        members={[...members, member('44444444-4444-4444-8444-444444444444', null, true)]}
        initial={null}
        onRecorded={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );
    expect(container.textContent).toContain(en.groups.detail.unnamed);
  });

  it('renders in Spanish and in English', () => {
    stubApi({ [ACCOUNTS]: { status: 200, body: accountList } });
    open({ locale: 'es' });
    expect(screen.getByLabelText(es.groups.settlement.fields.amount)).toBeTruthy();
    expect(screen.getByRole('button', { name: es.groups.settlement.submit })).toBeTruthy();
    expect(document.body.textContent).toContain(`Bruno paga a Ana 1.500,00${NBSP}ARS`);
  });
});
