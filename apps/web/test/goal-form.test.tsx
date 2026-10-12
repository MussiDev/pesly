// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateGoalContainer } from '../src/features/goals/form/create-goal-container';
import { EditGoalContainer } from '../src/features/goals/form/edit-goal-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GOAL_ID = '77777777-7777-4777-8777-777777777777';
const ACCOUNT_ID = '88888888-8888-4888-8888-888888888888';
const USD_ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CREATE = 'POST /goals';
const GET = `GET /goals/${GOAL_ID}`;
const PATCH = `PATCH /goals/${GOAL_ID}`;

const goal = (overrides: Record<string, unknown> = {}) => ({
  id: GOAL_ID,
  name: 'Trip',
  targetAmount: '100000',
  currency: 'ARS',
  targetDate: '2027-06-30',
  accountId: null,
  progress: '25000',
  percentage: 25,
  status: 'active',
  monthlyAmountNeeded: '8000',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const account = (id: string, name: string, currency: string, archived = false) => ({
  id,
  name,
  type: 'bank_account',
  currency,
  openingBalance: '0',
  balance: '0',
  includeInAvailable: true,
  archived,
  archivedAt: archived ? '2026-09-01T00:00:00.000Z' : null,
  createdAt: '2026-08-01T00:00:00.000Z',
});

const accountsAnswer = {
  status: 200,
  body: {
    items: [
      account(ACCOUNT_ID, 'Galicia', 'ARS'),
      account(USD_ACCOUNT_ID, 'Dollar box', 'USD'),
      account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Old ARS', 'ARS', true),
    ],
    availableTotals: { ARS: '0', USD: '0' },
    netWorthTotals: { ARS: '0', USD: '0' },
    debtTotals: { ARS: '0', USD: '0' },
    creditCardCount: 0,
    total: 3,
    limit: 100,
    offset: 0,
  },
} as const;

const f = en.goals.form;

async function fillCreate(name: string, amount: string) {
  const nameInput = screen.getByLabelText(f.name);
  await userEvent.clear(nameInput);
  if (name) await userEvent.type(nameInput, name);
  const amountInput = screen.getByLabelText(f.targetAmount);
  await userEvent.clear(amountInput);
  if (amount) await userEvent.type(amountInput, amount);
}

describe('CreateGoalContainer', () => {
  it('creates the goal and goes to the list', async () => {
    const { calls } = stubApi({ [CREATE]: { status: 201, body: goal() } });
    const { router } = renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate('  Trip ', '1000');
    await userEvent.type(screen.getByLabelText(f.targetDate), '2027-06-30');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/goals');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      name: 'Trip',
      targetAmount: '100000',
      currency: 'ARS',
      targetDate: '2027-06-30',
    });
  });

  it.each([
    ['', '1000', f.errors.nameRequired],
    ['x'.repeat(81), '1000', f.errors.nameTooLong],
    ['Trip', '', f.errors.amountInvalid],
    ['Trip', '0', f.errors.amountInvalid],
    ['Trip', 'abc', f.errors.amountInvalid],
  ])('shows a field error and sends nothing for %j / %j', async (name, amount, message) => {
    const { calls } = stubApi({});
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate(name, amount);
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(calls).toHaveLength(0);
    const invalid = document.querySelector('[aria-invalid="true"]');
    expect(document.activeElement).toBe(invalid);
  });

  it('makes no request until the link is chosen, then offers active accounts of the currency', async () => {
    const { calls } = stubApi({ [ACCOUNTS]: accountsAnswer });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: f.account }));
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: f.account });
    expect(calls).toHaveLength(1);
    const options = Array.from(select.options).map((o) => o.text);
    expect(options).toEqual([f.accountNone, 'Galicia']);

    await userEvent.selectOptions(screen.getByLabelText(f.currency), 'USD');
    const usd = screen.getByRole<HTMLSelectElement>('combobox', { name: f.account });
    expect(Array.from(usd.options).map((o) => o.text)).toEqual([f.accountNone, 'Dollar box']);
    expect(calls).toHaveLength(1);
  });

  it('clears the chosen account when the currency changes', async () => {
    stubApi({ [ACCOUNTS]: accountsAnswer });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await userEvent.click(screen.getByRole('checkbox', { name: f.account }));
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: f.account });
    await userEvent.selectOptions(select, ACCOUNT_ID);
    expect(select.value).toBe(ACCOUNT_ID);

    await userEvent.selectOptions(screen.getByLabelText(f.currency), 'USD');
    await userEvent.selectOptions(screen.getByLabelText(f.currency), 'ARS');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: f.account }).value).toBe('');
  });

  it('sends the chosen account', async () => {
    const { calls } = stubApi({
      [ACCOUNTS]: accountsAnswer,
      [CREATE]: { status: 201, body: goal({ accountId: ACCOUNT_ID }) },
    });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate('Trip', '1000');
    await userEvent.click(screen.getByRole('checkbox', { name: f.account }));
    await userEvent.selectOptions(
      await screen.findByRole<HTMLSelectElement>('combobox', { name: f.account }),
      ACCOUNT_ID,
    );
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });
    expect(calls.at(-1)?.body).toMatchObject({ accountId: ACCOUNT_ID });
    expect(calls).toHaveLength(2);
  });

  it('says so when there are no accounts in the currency', async () => {
    stubApi({
      [ACCOUNTS]: { status: 200, body: { ...accountsAnswer.body, items: [] } },
    });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await userEvent.click(screen.getByRole('checkbox', { name: f.account }));
    expect(await screen.findByText(f.noAccounts)).toBeTruthy();
  });

  it('shows the refused 100th goal and keeps the values', async () => {
    stubApi({ [CREATE]: { status: 409, body: { code: 'GOAL_LIMIT_REACHED' } } });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate('Trip', '1000');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.goalLimitReached)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Trip');
    expect(screen.getByLabelText<HTMLInputElement>(f.targetAmount).value).toBe('1,000');
  });

  it('shows the offline message and keeps the input on a network failure', async () => {
    stubApi({ [CREATE]: 'network-error' });
    const { router } = renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate('Trip', '1000');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.network)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Trip');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: f.submit }).disabled).toBe(false);
  });

  it('sends once on a double tap', async () => {
    const { calls } = stubApi({ [CREATE]: { status: 201, body: goal() } });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await fillCreate('Trip', '1000');
    const submit = screen.getByRole('button', { name: f.submit });
    await userEvent.dblClick(submit);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it('labels every control and gives buttons a 44 px target', async () => {
    stubApi({ [ACCOUNTS]: accountsAnswer });
    renderApp(<CreateGoalContainer />, { locale: 'en' });
    await userEvent.click(screen.getByRole('checkbox', { name: f.account }));
    await screen.findByRole<HTMLSelectElement>('combobox', { name: f.account });
    for (const label of [f.name, f.targetAmount, f.currency, f.targetDate]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]), select')) {
      expect(el.getAttribute('id')).toBeTruthy();
      expect(el.className).toMatch(/min-h-11/);
    }
    const submit = screen.getByRole('button', { name: f.submit });
    expect(submit.className).toMatch(/min-h-11/);
    expect(screen.getByRole('link', { name: f.cancel }).className).toMatch(/min-h-11/);
  });

  it('renders Spanish strings', () => {
    stubApi({});
    renderApp(<CreateGoalContainer />, { locale: 'es' });
    expect(screen.getByRole('heading', { name: es.goals.form.createTitle })).toBeTruthy();
    expect(screen.getByLabelText(es.goals.form.name)).toBeTruthy();
    expect(screen.getByRole('button', { name: es.goals.form.submit })).toBeTruthy();
  });
});

describe('EditGoalContainer', () => {
  it('loads the goal in one request, shows currency and account read only and no link', async () => {
    const { calls } = stubApi({ [GET]: { status: 200, body: goal({ accountId: ACCOUNT_ID }) } });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    expect((await screen.findByLabelText<HTMLInputElement>(f.name)).value).toBe('Trip');
    expect(screen.getByLabelText<HTMLInputElement>(f.targetAmount).value).toBe('1,000.00');
    expect(screen.getByLabelText<HTMLInputElement>(f.targetDate).value).toBe('2027-06-30');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText(f.currency, { selector: 'select' })).toBeNull();
    expect(screen.getByText(f.currency)).toBeTruthy();
    expect(screen.getByText('ARS')).toBeTruthy();
    expect(screen.getByText(f.account)).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it('sends only the changes and shows the figures the API returned', async () => {
    const { calls } = stubApi({
      [GET]: { status: 200, body: goal() },
      [PATCH]: {
        status: 200,
        body: goal({
          name: 'Trip 2',
          percentage: 40,
          progress: '40000',
          monthlyAmountNeeded: '5000',
        }),
      },
    });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await userEvent.clear(name);
    await userEvent.type(name, 'Trip 2');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    expect(await screen.findByText('40% saved')).toBeTruthy();
    expect(screen.getByText('ARS 50.00 per month needed')).toBeTruthy();
    expect(calls.at(-1)?.body).toEqual({ name: 'Trip 2' });
  });

  it('clearing the target date sends null and shows no monthly amount', async () => {
    const { calls } = stubApi({
      [GET]: { status: 200, body: goal() },
      [PATCH]: {
        status: 200,
        body: goal({ targetDate: null, monthlyAmountNeeded: null }),
      },
    });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    await screen.findByLabelText(f.name);
    await userEvent.click(screen.getByRole('button', { name: f.clearTargetDate }));
    expect(screen.getByLabelText<HTMLInputElement>(f.targetDate).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    expect(await screen.findByText('25% saved')).toBeTruthy();
    expect(calls.at(-1)?.body).toEqual({ targetDate: null });
    expect(screen.queryByText(/per month needed/)).toBeNull();
  });

  it.each([
    ['name', f.name, '', f.errors.nameRequired],
    ['amount', f.targetAmount, '0', f.errors.amountInvalid],
  ])(
    'an empty or invalid %s shows a field error and sends nothing',
    async (_n, label, value, message) => {
      const { calls } = stubApi({ [GET]: { status: 200, body: goal() } });
      renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
      const input = await screen.findByLabelText(label);
      await userEvent.clear(input);
      if (value) await userEvent.type(input, value);
      await userEvent.click(screen.getByRole('button', { name: f.submit }));
      expect(await screen.findByText(message)).toBeTruthy();
      expect(calls).toHaveLength(1);
    },
  );

  it('shows not found for a missing goal', async () => {
    stubApi({ [GET]: { status: 404, body: { code: 'NOT_FOUND' } } });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    expect(await screen.findByText(en.goals.detail.notFound.title)).toBeTruthy();
  });

  it('shows a failed load with a retry', async () => {
    const { calls } = stubApi({ [GET]: [{ status: 500 }, { status: 200, body: goal() }] });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByLabelText(f.name)).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it('keeps the input on a network failure when saving', async () => {
    stubApi({ [GET]: { status: 200, body: goal() }, [PATCH]: 'network-error' });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await userEvent.clear(name);
    await userEvent.type(name, 'Other');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.network)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Other');
  });

  it('renders Spanish strings', async () => {
    stubApi({ [GET]: { status: 200, body: goal() } });
    renderApp(<EditGoalContainer goalId={GOAL_ID} />, { locale: 'es' });
    expect(await screen.findByLabelText(es.goals.form.name)).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.goals.form.editTitle })).toBeTruthy();
  });
});
