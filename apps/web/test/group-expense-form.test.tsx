// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExpenseFormContainer } from '../src/features/groups/expenses/form/expense-form-container';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const form = en.groups.expenses.form;
const split = en.groups.split;

const G = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const GROUP_CATEGORY = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '66666666-6666-4666-8666-666666666666';
const PERSONAL_CATEGORY = '77777777-7777-4777-8777-777777777777';

const OPTIONS = `GET /groups/${G}/expense-options`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const CREATE = `POST /groups/${G}/expenses`;

const NOW = new Date('2026-10-11T15:00:00.000Z');
const ZONE = 'America/Argentina/Buenos_Aires';

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  isGhost: false,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const options = (defaultSplit: unknown = { mode: 'equal' }) => ({
  selfMemberId: ANA,
  members: [member(ANA, 'Ana'), member(BRUNO, 'Bruno'), member(CARLA, 'Carla')],
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
  defaultSplit,
  defaultRateType: 'blue',
});

const accountsPage = (items: unknown[] = [account('ARS')]) => ({
  items,
  availableTotals: { ARS: '0', USD: '0' },
  netWorthTotals: { ARS: '0', USD: '0' },
  debtTotals: { ARS: '0', USD: '0' },
  creditCardCount: 0,
  total: items.length,
  limit: 100,
  offset: 0,
});

function account(currency: 'ARS' | 'USD') {
  return {
    id: currency === 'ARS' ? ACCOUNT : '88888888-8888-4888-8888-888888888888',
    name: `Wallet ${currency}`,
    type: 'cash',
    currency,
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

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

const CREATED = {
  id: '99999999-9999-4999-8999-999999999999',
  groupId: G,
  payerMemberId: BRUNO,
  createdByMemberId: ANA,
  amount: '10000',
  currency: 'ARS',
  occurredAt: '2026-10-11T15:00:00.000Z',
  categoryId: GROUP_CATEGORY,
  description: 'Groceries',
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-11T15:00:00.000Z',
  shares: [],
  version: 1,
};

type Routes = Parameters<typeof stubApi>[0];

function routes(overrides: Routes = {}, defaultSplit?: unknown, accounts?: unknown[]): Routes {
  return {
    [OPTIONS]: { status: 200, body: options(defaultSplit) },
    [ACCOUNTS]: { status: 200, body: accountsPage(accounts) },
    [CATEGORIES]: { status: 200, body: categoriesPage },
    [CREATE]: { status: 201, body: CREATED },
    ...overrides,
  };
}

function open(locale: 'en' | 'es' = 'en') {
  return renderApp(<ExpenseFormContainer groupId={G} timeZone={ZONE} now={NOW} />, { locale });
}

async function ready() {
  await screen.findByLabelText(form.fields.amount);
}

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: form.submit });
const named = (template: string, name: string) => template.replace('{name}', name);

async function fillBasics(payer: string | null = 'Bruno') {
  await userEvent.type(field(form.fields.amount), '100');
  await userEvent.type(field(form.fields.description), 'Groceries');
  await userEvent.selectOptions(field(form.fields.category), 'Rent');
  if (payer !== null) await userEvent.selectOptions(field(form.fields.payer), payer);
}

const posts = (calls: { method: string }[]) => calls.filter((call) => call.method === 'POST');

describe('ExpenseFormContainer', () => {
  it('creates the expense and returns to the list', async () => {
    const { calls } = stubApi(routes());
    const { router } = open();
    await ready();
    await fillBasics();

    await userEvent.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G}/expenses`);
    });
    expect(posts(calls)).toHaveLength(1);
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      amount: '10000',
      currency: 'ARS',
      occurredAt: '2026-10-11T15:00:00.000Z',
      payerMemberId: BRUNO,
      categoryId: GROUP_CATEGORY,
      description: 'Groceries',
      split: { mode: 'equal', memberIds: [ANA, BRUNO, CARLA] },
    });
  });

  it('loads with at most 3 requests', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls).toHaveLength(3);
  });

  it.each(['', '0', 'abc'])(
    'rejects the amount %j with a field error and no request',
    async (amount) => {
      const { calls } = stubApi(routes());
      open();
      await ready();
      await userEvent.type(field(form.fields.description), 'Groceries');
      await userEvent.selectOptions(field(form.fields.category), 'Rent');
      await userEvent.selectOptions(field(form.fields.payer), 'Bruno');
      if (amount !== '') await userEvent.type(field(form.fields.amount), amount);

      await userEvent.click(submit());

      const message = await screen.findByText(
        amount === '0' ? en.movements.errors.amountNotPositive : en.movements.errors.amountInvalid,
      );
      expect(message).toBeTruthy();
      expect(field(form.fields.amount).getAttribute('aria-invalid')).toBe('true');
      expect(posts(calls)).toHaveLength(0);
    },
  );

  it.each([
    ['', form.errors.descriptionRequired],
    ['x'.repeat(201), form.errors.descriptionTooLong],
  ])(
    'rejects a description of %j.length characters without a request',
    async (description, message) => {
      const { calls } = stubApi(routes());
      open();
      await ready();
      await userEvent.type(field(form.fields.amount), '100');
      await userEvent.selectOptions(field(form.fields.category), 'Rent');
      await userEvent.selectOptions(field(form.fields.payer), 'Bruno');
      if (description !== '') {
        await userEvent.click(field(form.fields.description));
        await userEvent.paste(description);
      }

      await userEvent.click(submit());

      expect(await screen.findByText(message.replace('{max}', '200'))).toBeTruthy();
      expect(posts(calls)).toHaveLength(0);
    },
  );

  it('keeps amount and payer and resets the per-member values when the mode changes', async () => {
    stubApi(routes());
    open();
    await ready();
    await userEvent.type(field(form.fields.amount), '100');
    await userEvent.selectOptions(field(form.fields.payer), 'Bruno');
    await userEvent.click(screen.getByRole('radio', { name: split.modes.percentage }));
    await userEvent.type(field(named(split.percentage.field, 'Ana')), '60');

    await userEvent.click(screen.getByRole('radio', { name: split.modes.exact }));

    expect(field(form.fields.amount).value).toBe('100');
    expect(field(form.fields.payer).value).toBe(BRUNO);
    expect(field(named(split.exact.field, 'Ana')).value).toBe('');
  });

  it('shows each equal share with the leftover cent to the payer first', async () => {
    stubApi(routes());
    open();
    await ready();
    await userEvent.type(field(form.fields.amount), '100');
    await userEvent.selectOptions(field(form.fields.payer), 'Carla');

    const share = (name: string) =>
      screen.getByRole('checkbox', { name }).closest('li')?.textContent ?? '';
    expect(share('Carla')).toContain(formatMoney(3334n, 'ARS', 'en'));
    expect(share('Ana')).toContain(formatMoney(3333n, 'ARS', 'en'));
    expect(share('Bruno')).toContain(formatMoney(3333n, 'ARS', 'en'));
  });

  it('recomputes the shares when a member is unchecked', async () => {
    stubApi(routes());
    open();
    await ready();
    await userEvent.type(field(form.fields.amount), '100');
    await userEvent.selectOptions(field(form.fields.payer), 'Bruno');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Carla' }));

    const row = screen.getByRole('checkbox', { name: 'Ana' }).closest('li');
    expect(row?.textContent).toContain(formatMoney(5000n, 'ARS', 'en'));
  });

  it('shows the difference and disables sending when percentages do not total 100%', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    await fillBasics();
    await userEvent.click(screen.getByRole('radio', { name: split.modes.percentage }));
    await userEvent.type(field(named(split.percentage.field, 'Ana')), '50');
    await userEvent.type(field(named(split.percentage.field, 'Bruno')), '49.99');

    expect(
      screen.getByText(split.summary.percentageMissing.replace('{value}', '0.01%')),
    ).toBeTruthy();
    expect(submit().disabled).toBe(true);
    expect(posts(calls)).toHaveLength(0);

    await userEvent.clear(field(named(split.percentage.field, 'Bruno')));
    await userEvent.type(field(named(split.percentage.field, 'Bruno')), '50');
    expect(submit().disabled).toBe(false);
  });

  it('shows the remaining amount and disables sending when exact amounts fall short', async () => {
    stubApi(routes());
    open();
    await ready();
    await fillBasics();
    await userEvent.click(screen.getByRole('radio', { name: split.modes.exact }));
    await userEvent.type(field(named(split.exact.field, 'Ana')), '60');
    await userEvent.type(field(named(split.exact.field, 'Bruno')), '30');

    expect(screen.getByRole('status').textContent).toContain(
      split.summary.exactRemaining.replace('{amount}', formatMoney(1000n, 'ARS', 'en')),
    );
    expect(submit().disabled).toBe(true);
  });

  it('sends an exact split that adds up', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    await fillBasics();
    await userEvent.click(screen.getByRole('radio', { name: split.modes.exact }));
    await userEvent.type(field(named(split.exact.field, 'Ana')), '60');
    await userEvent.type(field(named(split.exact.field, 'Bruno')), '40');

    await userEvent.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      split: {
        mode: 'exact',
        shares: [
          { memberId: ANA, amount: '6000' },
          { memberId: BRUNO, amount: '4000' },
        ],
      },
    });
  });

  it('sends a percentage split that totals 100%', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    await fillBasics();
    await userEvent.click(screen.getByRole('radio', { name: split.modes.percentage }));
    await userEvent.type(field(named(split.percentage.field, 'Ana')), '33.34');
    await userEvent.type(field(named(split.percentage.field, 'Bruno')), '33.33');
    await userEvent.type(field(named(split.percentage.field, 'Carla')), '33.33');

    await userEvent.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      split: {
        mode: 'percentage',
        shares: [
          { memberId: ANA, basisPoints: 3334 },
          { memberId: BRUNO, basisPoints: 3333 },
          { memberId: CARLA, basisPoints: 3333 },
        ],
      },
    });
  });

  it('prefills the default percentage split', async () => {
    stubApi(
      routes(
        {},
        {
          mode: 'percentage',
          shares: [
            { memberId: ANA, basisPoints: 7000 },
            { memberId: BRUNO, basisPoints: 3000 },
          ],
        },
      ),
    );
    open();
    await ready();

    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: split.modes.percentage }).checked,
    ).toBe(true);
    expect(field(named(split.percentage.field, 'Ana')).value).toBe('70');
    expect(field(named(split.percentage.field, 'Carla')).value).toBe('');
  });

  it('shows the server split refusal and keeps everything entered', async () => {
    stubApi(
      routes({
        [CREATE]: { status: 400, body: { code: 'GROUP_SPLIT_AMOUNT_MISMATCH', message: 'x' } },
      }),
    );
    open();
    await ready();
    await fillBasics();
    await userEvent.click(submit());

    expect(await screen.findByText(en.errors.groupSplitAmountMismatch)).toBeTruthy();
    expect(field(form.fields.amount).value).toBe('100');
    expect(field(form.fields.description).value).toBe('Groceries');
    expect(field(form.fields.payer).value).toBe(BRUNO);
    expect(field(form.fields.category).value).toBe(GROUP_CATEGORY);
  });

  it.each([
    [403, 'GROUP_ADMIN_REQUIRED', en.errors.groupAdminRequired],
    [404, 'NOT_FOUND', en.errors.unexpected],
  ])('shows the message of a %i answer and keeps the form', async (status, code, message) => {
    stubApi(routes({ [CREATE]: { status, body: { code, message: 'x' } } }));
    const { router } = open();
    await ready();
    await fillBasics();
    await userEvent.click(submit());

    expect(await screen.findByText(message)).toBeTruthy();
    expect(field(form.fields.description).value).toBe('Groceries');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('requires an account and a personal category when the payer is the current user', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    await userEvent.type(field(form.fields.amount), '100');
    await userEvent.type(field(form.fields.description), 'Groceries');
    await userEvent.selectOptions(field(form.fields.category), 'Rent');
    expect(field(form.fields.payer).value).toBe(ANA);

    await userEvent.click(submit());

    expect(await screen.findByText(form.errors.accountRequired)).toBeTruthy();
    expect(screen.getByText(form.errors.personalCategoryRequired)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);

    await userEvent.selectOptions(field(form.fields.account), 'Wallet ARS');
    await userEvent.selectOptions(field(form.fields.personalCategory), 'Food');
    await userEvent.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      payerMemberId: ANA,
      payerAccount: { accountId: ACCOUNT, categoryId: PERSONAL_CATEGORY },
    });
  });

  it('says there is no account in the currency and sends nothing', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    await userEvent.type(field(form.fields.amount), '100');
    await userEvent.type(field(form.fields.description), 'Groceries');
    await userEvent.selectOptions(field(form.fields.category), 'Rent');
    await userEvent.selectOptions(field(form.fields.currency), 'USD');

    expect(screen.getByText(form.errors.noAccountInCurrency)).toBeTruthy();
    await userEvent.click(submit());

    expect(posts(calls)).toHaveLength(0);
    expect(screen.getAllByText(form.errors.noAccountInCurrency).length).toBeGreaterThan(0);
  });

  it('does not render or send the account fields when another member pays', async () => {
    const { calls } = stubApi(routes());
    open();
    await ready();
    expect(screen.getByLabelText(form.fields.account)).toBeTruthy();
    await fillBasics('Bruno');

    expect(screen.queryByLabelText(form.fields.account)).toBeNull();
    expect(screen.queryByLabelText(form.fields.personalCategory)).toBeNull();
    await userEvent.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).not.toHaveProperty('payerAccount');
  });

  it('renders Spanish strings', async () => {
    stubApi(routes());
    open('es');
    await screen.findByLabelText(es.groups.expenses.form.fields.amount);
    const equal = screen.getByRole('radio', { name: es.groups.split.modes.equal });
    expect(equal).toBeTruthy();
    expect(
      within(document.body).getByRole('button', { name: es.groups.expenses.form.submit }),
    ).toBeTruthy();
  });

  it('shows the retry state when loading fails', async () => {
    stubApi(routes({ [OPTIONS]: { status: 500 } }));
    open();
    expect(await screen.findByRole('button', { name: en.app.retry })).toBeTruthy();
  });
});
