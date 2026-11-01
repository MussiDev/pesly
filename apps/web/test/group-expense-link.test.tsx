// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkExpenseContainer } from '../src/features/groups/expenses/link/link-expense-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const link = en.groups.expenses.link;

const G = '55555555-5555-4555-8555-555555555555';
const E = '99999999-9999-4999-8999-999999999999';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const GROUP_CATEGORY = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '66666666-6666-4666-8666-666666666666';
const USD_ACCOUNT = '88888888-8888-4888-8888-888888888888';
const PERSONAL_CATEGORY = '77777777-7777-4777-8777-777777777777';
const MOVEMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const EXPENSE_ROUTE = `GET /groups/${G}/expenses/${E}`;
const OPTIONS = `GET /groups/${G}/expense-options`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const CANDIDATES = `GET /groups/${G}/expenses/${E}/movement-candidates`;
const LINK = `POST /groups/${G}/expenses/${E}/payer-movement`;

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  isGhost: false,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const options = (selfMemberId = ANA) => ({
  selfMemberId,
  members: [member(ANA, 'Ana'), member(BRUNO, 'Bruno')],
  categories: [
    {
      id: GROUP_CATEGORY,
      defaultKey: null,
      name: 'Rent',
      icon: 'home',
      color: 'blue',
      archivedAt: null,
    },
  ],
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
});

const expense = (overrides: Record<string, unknown> = {}) => ({
  id: E,
  groupId: G,
  payerMemberId: ANA,
  createdByMemberId: BRUNO,
  amount: '4000000',
  currency: 'ARS',
  occurredAt: '2026-10-10T10:00:00.000Z',
  categoryId: GROUP_CATEGORY,
  description: 'Supermarket',
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-10T10:01:00.000Z',
  shares: [
    { memberId: ANA, amount: '2000000' },
    { memberId: BRUNO, amount: '2000000' },
  ],
  version: 1,
  ...overrides,
});

function account(id: string, name: string, currency: 'ARS' | 'USD', archived = false) {
  return {
    id,
    name,
    type: 'cash',
    currency,
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived,
    archivedAt: archived ? '2026-10-02T00:00:00.000Z' : null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const accountsPage = (items: unknown[]) => ({
  items,
  availableTotals: { ARS: '0', USD: '0' },
  netWorthTotals: { ARS: '0', USD: '0' },
  debtTotals: { ARS: '0', USD: '0' },
  creditCardCount: 0,
  total: items.length,
  limit: 100,
  offset: 0,
});

const categoriesPage = {
  items: [
    {
      id: PERSONAL_CATEGORY,
      kind: 'expense',
      parentId: null,
      key: null,
      name: 'Food',
      icon: 'utensils',
      color: 'orange',
      archived: false,
      archivedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
};

const candidate = {
  id: MOVEMENT,
  amount: '4000000',
  occurredAt: '2026-10-09T10:00:00.000Z',
  note: 'Chango',
  accountId: ACCOUNT,
  accountName: 'Wallet ARS',
};

const routes = (overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) => ({
  [EXPENSE_ROUTE]: { status: 200 as const, body: expense() },
  [OPTIONS]: { status: 200 as const, body: options() },
  [ACCOUNTS]: {
    status: 200 as const,
    body: accountsPage([
      account(ACCOUNT, 'Wallet ARS', 'ARS'),
      account(USD_ACCOUNT, 'Wallet USD', 'USD'),
      account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Old ARS', 'ARS', true),
    ]),
  },
  [CATEGORIES]: { status: 200 as const, body: categoriesPage },
  [CANDIDATES]: { status: 200 as const, body: { items: [candidate] } },
  ...overrides,
});

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<LinkExpenseContainer groupId={G} expenseId={E} />, { locale });

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

afterEach(() => {
  setOnline(true);
});

describe('LinkExpenseContainer, the create way', () => {
  it('offers only the open accounts in the currency of the expense and the personal categories (AC-21)', async () => {
    stubApi(routes());
    open();

    const account = await screen.findByLabelText(en.groups.expenses.form.fields.account);
    const options = Array.from(account.querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    expect(options).toContain('Wallet ARS');
    expect(options).not.toContain('Wallet USD');
    expect(options).not.toContain('Old ARS');
    expect(screen.getByRole('radio', { name: 'Food' })).toBeTruthy();
  });

  it('sends the chosen account and category and goes back to the expenses list (AC-02, AC-23)', async () => {
    const { calls } = stubApi(
      routes({ [LINK]: { status: 200, body: expense({ payerMovementId: MOVEMENT }) } }),
    );
    const { router } = open();
    await userEvent.selectOptions(
      await screen.findByLabelText(en.groups.expenses.form.fields.account),
      ACCOUNT,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Food' }));

    await userEvent.click(screen.getByRole('button', { name: link.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G}/expenses`);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      mode: 'create',
      accountId: ACCOUNT,
      categoryId: PERSONAL_CATEGORY,
    });
  });

  it('asks for the account and the category and sends nothing when they are empty (invalid input)', async () => {
    const { calls } = stubApi(routes());
    open();

    await userEvent.click(await screen.findByRole('button', { name: link.submit }));

    expect(await screen.findByText(link.errors.account)).toBeTruthy();
    expect(screen.getByText(link.errors.category)).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('says there is no account in the currency when there is none (error)', async () => {
    stubApi(
      routes({
        [ACCOUNTS]: { status: 200, body: accountsPage([account(USD_ACCOUNT, 'W', 'USD')]) },
      }),
    );
    open();

    expect(
      await screen.findByText(en.groups.expenses.form.errors.noAccountInCurrency),
    ).toBeTruthy();
  });
});

describe('LinkExpenseContainer, the adopt way', () => {
  it('lists the candidates and sends the one that was chosen (AC-11)', async () => {
    const { calls } = stubApi(
      routes({ [LINK]: { status: 200, body: expense({ payerMovementId: MOVEMENT }) } }),
    );
    const { router } = open();
    await userEvent.click(await screen.findByRole('radio', { name: link.ways.adopt }));

    await userEvent.click(await screen.findByRole('radio', { name: /Chango/ }));
    await userEvent.click(screen.getByRole('button', { name: link.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G}/expenses`);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      mode: 'adopt',
      movementId: MOVEMENT,
    });
  });

  it('says there is no candidate and offers the create way when there is none (AC-22)', async () => {
    stubApi(routes({ [CANDIDATES]: { status: 200, body: { items: [] } } }));
    open();
    await userEvent.click(await screen.findByRole('radio', { name: link.ways.adopt }));

    expect(await screen.findByText(link.noCandidates)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: link.useCreate }));

    expect(await screen.findByLabelText(en.groups.expenses.form.fields.account)).toBeTruthy();
  });

  it('keeps the chosen way and movement when the movement is not found on submit, instead of saying the expense is gone (AC-24, AC-15)', async () => {
    stubApi(routes({ [LINK]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const { router } = open();
    await userEvent.click(await screen.findByRole('radio', { name: link.ways.adopt }));
    await userEvent.click(await screen.findByRole('radio', { name: /Chango/ }));

    await userEvent.click(screen.getByRole('button', { name: link.submit }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Chango/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(link.notFound)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('asks to choose a movement and sends nothing when none is chosen (invalid input)', async () => {
    const { calls } = stubApi(routes());
    open();
    await userEvent.click(await screen.findByRole('radio', { name: link.ways.adopt }));

    await userEvent.click(await screen.findByRole('button', { name: link.submit }));

    expect(await screen.findByText(link.errors.movement)).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows a retry in the adopt way when the candidates fail to load, and keeps the create way (error)', async () => {
    stubApi(routes({ [CANDIDATES]: { status: 500 } }));
    open();
    await userEvent.click(await screen.findByRole('radio', { name: link.ways.adopt }));

    expect(await screen.findByText(link.candidatesFailed)).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: link.ways.create }));
    expect(await screen.findByLabelText(en.groups.expenses.form.fields.account)).toBeTruthy();
  });
});

describe('LinkExpenseContainer, failures and states', () => {
  it('shows the refusal and keeps the choices when the server refuses the link (AC-24)', async () => {
    stubApi(routes({ [LINK]: { status: 409, body: { code: 'GROUP_EXPENSE_ALREADY_LINKED' } } }));
    const { router } = open();
    const account = await screen.findByLabelText(en.groups.expenses.form.fields.account);
    await userEvent.selectOptions(account, ACCOUNT);
    await userEvent.click(screen.getByRole('radio', { name: 'Food' }));

    await userEvent.click(screen.getByRole('button', { name: link.submit }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((account as HTMLSelectElement).value).toBe(ACCOUNT);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the failure and lets the person try again after a network error (AC-24)', async () => {
    stubApi(routes({ [LINK]: 'network-error' }));
    open();
    await userEvent.selectOptions(
      await screen.findByLabelText(en.groups.expenses.form.fields.account),
      ACCOUNT,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Food' }));

    await userEvent.click(screen.getByRole('button', { name: link.submit }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: link.submit })).toBeTruthy();
  });

  it('sends nothing and says linking needs a connection while the device is offline (AC-25)', async () => {
    setOnline(false);
    const { calls } = stubApi(routes());
    open();

    expect(await screen.findByText(link.offline)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows the not found view for an expense that does not exist (404)', async () => {
    stubApi(routes({ [EXPENSE_ROUTE]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    open();

    expect(await screen.findByText(link.notFound)).toBeTruthy();
    expect(screen.getByRole('link', { name: link.back }).getAttribute('href')).toBe(
      `/en/groups/${G}/expenses`,
    );
  });

  it('says only the payer can link when the caller is not the payer (403)', async () => {
    const { calls } = stubApi(routes({ [OPTIONS]: { status: 200, body: options(BRUNO) } }));
    open();

    expect(await screen.findByText(link.notPayer)).toBeTruthy();
    expect(calls.some((call) => call.path.endsWith('/movement-candidates'))).toBe(false);
  });

  it('says the expense is already linked when it has a movement (409)', async () => {
    stubApi(
      routes({ [EXPENSE_ROUTE]: { status: 200, body: expense({ payerMovementId: MOVEMENT }) } }),
    );
    open();

    expect(await screen.findByText(link.alreadyLinked)).toBeTruthy();
  });

  it('goes to sign-in when the session is gone (401)', async () => {
    stubApi(routes({ [EXPENSE_ROUTE]: { status: 401, body: { code: 'UNAUTHENTICATED' } } }));
    const { router } = open();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('shows a retry when the expense cannot be loaded (error)', async () => {
    stubApi(routes({ [EXPENSE_ROUTE]: { status: 500 } }));
    open();

    expect(await screen.findByRole('button', { name: en.app.retry })).toBeTruthy();
  });

  it('renders in Spanish (AC-26)', async () => {
    stubApi(routes());
    open('es');

    expect(
      await screen.findByRole('heading', { name: es.groups.expenses.link.title }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: es.groups.expenses.link.ways.adopt })).toBeTruthy();
  });
});
