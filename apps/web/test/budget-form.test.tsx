// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateBudgetContainer } from '../src/features/budgets/form/create-budget-container';
import { EditBudgetContainer } from '../src/features/budgets/form/edit-budget-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const BUDGET_ID = '77777777-7777-4777-8777-777777777777';
const FOOD = '11111111-1111-4111-8111-111111111111';
const GROCERIES = '22222222-2222-4222-8222-222222222222';
const TRANSPORT = '33333333-3333-4333-8333-333333333333';
const GONE = '55555555-5555-4555-8555-555555555555';
const SALARY = '44444444-4444-4444-8444-444444444444';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const CREATE = 'POST /budgets';
const GET = `GET /budgets/${BUDGET_ID}`;
const PATCH = `PATCH /budgets/${BUDGET_ID}`;

const category = (
  id: string,
  name: string,
  kind: 'expense' | 'income',
  parentId: string | null = null,
) => ({
  id,
  kind,
  parentId,
  key: null,
  name,
  icon: 'coffee',
  color: 'red',
  archived: false,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
});

const categoriesAnswer = {
  status: 200,
  body: {
    items: [
      category(GROCERIES, 'Groceries', 'expense', FOOD),
      category(FOOD, 'Food', 'expense'),
      category(TRANSPORT, 'Transport', 'expense'),
      category(SALARY, 'Salary', 'income'),
    ],
    total: 4,
    limit: 100,
    offset: 0,
  },
} as const;

const budget = (overrides: Record<string, unknown> = {}) => ({
  id: BUDGET_ID,
  name: 'Home',
  amount: '100000',
  currency: 'ARS',
  rollover: false,
  thresholds: [80, 100],
  categoryIds: [FOOD],
  coveredCategoryIds: [FOOD, GROCERIES],
  effectiveFrom: '2026-10-01',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const f = en.budgets.form;
const removeName = (value: number) => f.thresholds.remove.replace('{percent}', `${value}`);
const removeButton = (value: number) => screen.queryByRole('button', { name: removeName(value) });

async function fillCreate(name: string, amount: string) {
  const nameInput = await screen.findByLabelText(f.name);
  await userEvent.clear(nameInput);
  if (name) await userEvent.type(nameInput, name);
  const amountInput = screen.getByLabelText(f.amount);
  await userEvent.clear(amountInput);
  if (amount) await userEvent.type(amountInput, amount);
}

async function pick(label: string) {
  await userEvent.click(await screen.findByRole('checkbox', { name: label }));
}

describe('CreateBudgetContainer', () => {
  it('creates the budget with the default thresholds and goes to the list', async () => {
    const { calls } = stubApi({
      [CATEGORIES]: categoriesAnswer,
      [CREATE]: { status: 201, body: budget() },
    });
    const { router } = renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('  Home ', '1000');
    await pick('Food');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/budgets');
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.at(-1)?.body).toEqual({
      name: 'Home',
      amount: '100000',
      currency: 'ARS',
      categoryIds: [FOOD],
      rollover: false,
      thresholds: [80, 100],
    });
  });

  it('sends the chosen currency, rollover and a changed thresholds list', async () => {
    const { calls } = stubApi({
      [CATEGORIES]: categoriesAnswer,
      [CREATE]: { status: 201, body: budget() },
    });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('Trips', '50');
    await userEvent.selectOptions(screen.getByLabelText(f.currency), 'USD');
    await pick('Transport');
    await userEvent.click(screen.getByRole('checkbox', { name: f.rollover }));
    await userEvent.click(removeButton(80) as HTMLElement);
    await userEvent.type(screen.getByLabelText(f.thresholds.input), '50');
    await userEvent.click(screen.getByRole('button', { name: f.thresholds.add }));
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    expect(calls.at(-1)?.body).toEqual({
      name: 'Trips',
      amount: '5000',
      currency: 'USD',
      categoryIds: [TRANSPORT],
      rollover: true,
      thresholds: [50, 100],
    });
  });

  it.each([
    ['', '1000', true, f.errors.nameRequired],
    ['x'.repeat(51), '1000', true, f.errors.nameTooLong],
    ['Home', '', true, f.errors.amountInvalid],
    ['Home', '0', true, f.errors.amountInvalid],
    ['Home', 'abc', true, f.errors.amountInvalid],
    ['Home', '1000', false, f.errors.categoriesRequired],
  ])(
    'shows a field error and sends no request for %j / %j / category %j',
    async (name, amount, withCategory, message) => {
      const { calls } = stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await fillCreate(name, amount);
      if (withCategory) await pick('Food');
      await userEvent.click(screen.getByRole('button', { name: f.submit }));
      expect(await screen.findByText(message)).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      expect(document.activeElement).toBe(document.querySelector('[aria-invalid="true"]'));
    },
  );

  it('offers expense categories with subcategories under their parent and no income', async () => {
    stubApi({ [CATEGORIES]: categoriesAnswer });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await screen.findByRole('checkbox', { name: 'Food' });
    expect(screen.queryByRole('checkbox', { name: 'Salary' })).toBeNull();
    const group = screen.getByRole('group', {
      name: f.categoriesGroup.replace('{parent}', 'Food'),
    });
    expect(within(group).getByRole('checkbox', { name: 'Groceries' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Transport' })).toBeTruthy();
  });

  it('shows a category load failure with a retry and disables the submit until it loads', async () => {
    const { calls } = stubApi({ [CATEGORIES]: [{ status: 500 }, categoriesAnswer] });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    expect(await screen.findByText(f.categoriesError)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: f.submit }).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: f.categoriesRetry }));
    expect(await screen.findByRole('checkbox', { name: 'Food' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: f.submit }).disabled).toBe(false);
    expect(calls).toHaveLength(2);
  });

  describe('thresholds editor', () => {
    async function add(text: string) {
      const input = screen.getByLabelText<HTMLInputElement>(f.thresholds.input);
      await userEvent.clear(input);
      await userEvent.type(input, text);
      await userEvent.click(screen.getByRole('button', { name: f.thresholds.add }));
    }

    it('accepts a new whole number from 1 to 200', async () => {
      stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await screen.findByRole('checkbox', { name: 'Food' });
      await add('150');
      expect(removeButton(150)).toBeTruthy();
      await add('1');
      expect(removeButton(1)).toBeTruthy();
    });

    it.each([['0'], ['201'], ['10.5'], ['abc']])('rejects %j as invalid', async (text) => {
      stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await screen.findByRole('checkbox', { name: 'Food' });
      await add(text);
      expect(await screen.findByText(f.errors.thresholdInvalid)).toBeTruthy();
      expect(document.querySelectorAll('[data-threshold]')).toHaveLength(2);
    });

    it('rejects a duplicate', async () => {
      stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await screen.findByRole('checkbox', { name: 'Food' });
      await add('80');
      expect(await screen.findByText(f.errors.thresholdDuplicate)).toBeTruthy();
      expect(document.querySelectorAll('[data-threshold]')).toHaveLength(2);
    });

    it('hides the add control at 5 thresholds', async () => {
      stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await screen.findByRole('checkbox', { name: 'Food' });
      for (const value of ['10', '20', '30']) await add(value);
      expect(removeButton(30)).toBeTruthy();
      expect(screen.queryByRole('button', { name: f.thresholds.add })).toBeNull();
      expect(screen.queryByLabelText(f.thresholds.input)).toBeNull();
    });

    it('shows a field error and sends nothing when the last threshold is removed', async () => {
      const { calls } = stubApi({ [CATEGORIES]: categoriesAnswer });
      renderApp(<CreateBudgetContainer />, { locale: 'en' });
      await fillCreate('Home', '1000');
      await pick('Food');
      await userEvent.click(removeButton(80) as HTMLElement);
      await userEvent.click(removeButton(100) as HTMLElement);
      await userEvent.click(screen.getByRole('button', { name: f.submit }));
      expect(await screen.findByText(f.errors.thresholdsRequired)).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });
  });

  it('shows the refused 51st budget and keeps the values', async () => {
    stubApi({
      [CATEGORIES]: categoriesAnswer,
      [CREATE]: { status: 409, body: { code: 'BUDGET_LIMIT_REACHED' } },
    });
    const { router } = renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('Home', '1000');
    await pick('Groceries');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.budgetLimitReached)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Home');
    expect(screen.getByLabelText<HTMLInputElement>(f.amount).value).toBe('1,000');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Groceries' }).checked).toBe(
      true,
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the refused category kind and keeps the values', async () => {
    stubApi({
      [CATEGORIES]: categoriesAnswer,
      [CREATE]: { status: 400, body: { code: 'BUDGET_CATEGORY_KIND_INVALID' } },
    });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('Home', '1000');
    await pick('Food');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.budgetCategoryKindInvalid)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Home');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Food' }).checked).toBe(true);
  });

  it('shows the offline message and keeps the input on a network failure', async () => {
    stubApi({ [CATEGORIES]: categoriesAnswer, [CREATE]: 'network-error' });
    const { router } = renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('Home', '1000');
    await pick('Food');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.network)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Home');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: f.submit }).disabled).toBe(false);
  });

  it('makes one request to load and exactly one to save, even on a double tap', async () => {
    const { calls } = stubApi({
      [CATEGORIES]: categoriesAnswer,
      [CREATE]: { status: 201, body: budget() },
    });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await fillCreate('Home', '1000');
    await pick('Food');
    expect(calls).toHaveLength(1);
    await userEvent.dblClick(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('labels every control and gives every target 44 px', async () => {
    stubApi({ [CATEGORIES]: categoriesAnswer });
    renderApp(<CreateBudgetContainer />, { locale: 'en' });
    await screen.findByRole('checkbox', { name: 'Food' });
    for (const label of [f.name, f.amount, f.currency, f.thresholds.input]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]), select')) {
      expect(el.getAttribute('id')).toBeTruthy();
      expect(el.className).toMatch(/min-h-11/);
    }
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      const label = document.querySelector(`label[for="${box.id}"]`);
      expect(label, 'checkbox label').toBeTruthy();
      expect(label?.parentElement?.className).toMatch(/min-h-11/);
    }
    for (const name of [f.submit, f.thresholds.add, removeName(80)]) {
      expect(screen.getByRole('button', { name }).className).toMatch(/min-h-11|size-11/);
    }
    expect(screen.getByRole('link', { name: f.cancel }).className).toMatch(/min-h-11/);
    const hint = f.thresholds.hint.replace('{min}', '1').replace('{max}', '200');
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('renders Spanish strings', async () => {
    stubApi({ [CATEGORIES]: categoriesAnswer });
    renderApp(<CreateBudgetContainer />, { locale: 'es' });
    expect(screen.getByRole('heading', { name: es.budgets.form.createTitle })).toBeTruthy();
    expect(await screen.findByLabelText(es.budgets.form.name)).toBeTruthy();
    expect(screen.getByRole('button', { name: es.budgets.form.submit })).toBeTruthy();
  });
});

describe('EditBudgetContainer', () => {
  const stubEdit = (extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) =>
    stubApi({
      [GET]: { status: 200, body: budget() },
      [CATEGORIES]: categoriesAnswer,
      ...extra,
    });

  it('loads in 2 requests and shows the values, the currency read only and the note', async () => {
    const { calls } = stubEdit();
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    expect((await screen.findByLabelText<HTMLInputElement>(f.name)).value).toBe('Home');
    expect(screen.getByLabelText<HTMLInputElement>(f.amount).value).toBe('1,000.00');
    expect(await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Food' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Food' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Transport' }).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText(f.currency, { selector: 'select' })).toBeNull();
    expect(screen.getByText(f.currency)).toBeTruthy();
    expect(screen.getByText('ARS')).toBeTruthy();
    expect(screen.getByText(f.currencyReadOnly)).toBeTruthy();
    expect(screen.getByText(f.editNote)).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it('disables the save while nothing changed and enables it after a change', async () => {
    stubEdit();
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: f.submit });
    expect(save.disabled).toBe(true);
    await userEvent.type(name, 'x');
    expect(save.disabled).toBe(false);
    await userEvent.type(name, '{Backspace}');
    expect(save.disabled).toBe(true);
  });

  it('sends only the changed fields and shows the figures the API returned', async () => {
    const { calls } = stubEdit({
      [PATCH]: {
        status: 200,
        body: budget({ name: 'Home 2', amount: '250000', thresholds: [50, 80, 100] }),
      },
    });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Home 2');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));

    const status = await screen.findByRole('status');
    expect(within(status).getByText(/Home 2/)).toBeTruthy();
    expect(within(status).getByText(/2,500\.00/)).toBeTruthy();
    expect(within(status).getByText(/50%/)).toBeTruthy();
    expect(calls.at(-1)?.body).toEqual({ name: 'Home 2' });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('sends the categories and thresholds when they change', async () => {
    const { calls } = stubEdit({ [PATCH]: { status: 200, body: budget() } });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    await pick('Transport');
    await userEvent.click(removeButton(80) as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.at(-1)?.body).toEqual({ categoryIds: [FOOD, TRANSPORT], thresholds: [100] });
  });

  it('sends one save on a double tap', async () => {
    const { calls } = stubEdit({ [PATCH]: { status: 200, body: budget({ name: 'B' }) } });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.clear(name);
    await userEvent.type(name, 'B');
    await userEvent.dblClick(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('shows a field error and sends nothing for an invalid name', async () => {
    const { calls } = stubEdit();
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(f.errors.nameRequired)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('shows the not found state for a missing budget and for a malformed id', async () => {
    stubApi({
      [GET]: { status: 404, body: { code: 'NOT_FOUND' } },
      [CATEGORIES]: categoriesAnswer,
    });
    const first = renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    expect(await screen.findByText(en.budgets.detail.notFound.title)).toBeTruthy();
    first.unmount();

    const { calls } = stubApi({});
    renderApp(<EditBudgetContainer budgetId="not-an-id" />, { locale: 'en' });
    expect(await screen.findByText(en.budgets.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows a failed budget load with a retry', async () => {
    const { calls } = stubEdit({ [GET]: [{ status: 500 }, { status: 200, body: budget() }] });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByLabelText(f.name)).toBeTruthy();
    expect(calls.filter((c) => c.path === `/budgets/${BUDGET_ID}`)).toHaveLength(2);
  });

  it('shows a category load failure with its own retry and disables the save', async () => {
    stubEdit({ [CATEGORIES]: [{ status: 500 }, categoriesAnswer] });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    expect(await screen.findByText(f.categoriesError)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: f.submit }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: f.categoriesRetry }));
    expect(await screen.findByRole('checkbox', { name: 'Food' })).toBeTruthy();
  });

  it('keeps the input on a refusal and on a network failure when saving', async () => {
    stubEdit({
      [PATCH]: [{ status: 400, body: { code: 'BUDGET_CATEGORY_KIND_INVALID' } }, 'network-error'],
    });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Other');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.budgetCategoryKindInvalid)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Other');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(en.errors.network)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(f.name).value).toBe('Other');
  });

  it('shows a selected category the picker does not offer and lets it be unchecked (M1)', async () => {
    const { calls } = stubEdit({
      [GET]: { status: 200, body: budget({ categoryIds: [FOOD, GONE] }) },
      [PATCH]: { status: 200, body: budget() },
    });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    await screen.findByRole('checkbox', { name: 'Food' });
    const gone = screen.getByRole<HTMLInputElement>('checkbox', { name: f.categoryUnavailable });
    expect(gone.checked).toBe(true);

    await userEvent.click(gone);
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.at(-1)?.body).toEqual({ categoryIds: [FOOD] });
  });

  it('commits a typed but not added threshold on save (M2)', async () => {
    const { calls } = stubEdit({ [PATCH]: { status: 200, body: budget() } });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.type(screen.getByLabelText(f.thresholds.input), '50');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.at(-1)?.body).toEqual({ thresholds: [50, 80, 100] });
  });

  it('shows an error and sends nothing for an invalid typed threshold on save (M2)', async () => {
    const { calls } = stubEdit({ [PATCH]: { status: 200, body: budget() } });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.type(screen.getByLabelText(f.name), 'x');
    await userEvent.type(screen.getByLabelText(f.thresholds.input), '999');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(f.errors.thresholdInvalid)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('clears a field error as soon as the field is edited (L3)', async () => {
    stubEdit();
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    const amount = screen.getByLabelText(f.amount);

    await userEvent.clear(name);
    await userEvent.clear(amount);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Food' }));
    await userEvent.click(removeButton(80) as HTMLElement);
    await userEvent.click(removeButton(100) as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    for (const message of [
      f.errors.nameRequired,
      f.errors.amountInvalid,
      f.errors.categoriesRequired,
      f.errors.thresholdsRequired,
    ]) {
      expect(await screen.findByText(message)).toBeTruthy();
    }

    await userEvent.type(name, 'a');
    expect(screen.queryByText(f.errors.nameRequired)).toBeNull();
    await userEvent.type(amount, '5');
    expect(screen.queryByText(f.errors.amountInvalid)).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Food' }));
    expect(screen.queryByText(f.errors.categoriesRequired)).toBeNull();
    await userEvent.type(screen.getByLabelText(f.thresholds.input), '50');
    await userEvent.click(screen.getByRole('button', { name: f.thresholds.add }));
    expect(screen.queryByText(f.errors.thresholdsRequired)).toBeNull();
  });

  it('hides the saved summary once the user edits again (L6)', async () => {
    stubEdit({ [PATCH]: { status: 200, body: budget({ name: 'Home 2' }) } });
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'en' });
    const name = await screen.findByLabelText(f.name);
    await screen.findByRole('checkbox', { name: 'Food' });
    await userEvent.type(name, '2');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByRole('status')).toBeTruthy();

    await userEvent.type(name, '3');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders Spanish strings', async () => {
    stubEdit();
    renderApp(<EditBudgetContainer budgetId={BUDGET_ID} />, { locale: 'es' });
    expect(await screen.findByLabelText(es.budgets.form.name)).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.budgets.form.editTitle })).toBeTruthy();
    expect(screen.getByText(es.budgets.form.editNote)).toBeTruthy();
  });
});
