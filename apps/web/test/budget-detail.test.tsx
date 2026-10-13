// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BudgetDetailContainer } from '../src/features/budgets/detail/budget-detail-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

// Block 2 and Block 5 own these components; they are replaced by stubs here (spec D11).
vi.mock('../src/features/budgets/list/budget-progress', () => ({
  BudgetProgress: ({ view }: { view: { name: string; spent: bigint; month: string } }) => (
    <div data-testid="budget-progress">
      {view.name} {view.month} spent:{String(view.spent)}
    </div>
  ),
}));

vi.mock('../src/features/budgets/delete/budget-delete-action', () => ({
  BudgetDeleteAction: ({ budgetId, onDeleted }: { budgetId: string; onDeleted: () => void }) => (
    <button type="button" data-budget={budgetId} onClick={onDeleted}>
      stub-delete
    </button>
  ),
}));

const { en, es } = CATALOGS;
const BUDGET_ID = '11111111-1111-4111-8111-111111111111';
const FOOD = '22222222-2222-4222-8222-222222222221';
const BREAD = '22222222-2222-4222-8222-222222222222';
const FUN = '22222222-2222-4222-8222-222222222223';
const OTHER = '22222222-2222-4222-8222-222222222224';
const GET_BUDGET = `GET /budgets/${BUDGET_ID}`;
const GET_SPENDING = `GET /budgets/${BUDGET_ID}/spending`;
const GET_CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100&offset=0';

const ok = (body: unknown) => ({ status: 200, body });
const notFound = { status: 404, body: { code: 'NOT_FOUND', message: 'x' } };

const budget = (overrides: Record<string, unknown> = {}) => ({
  id: BUDGET_ID,
  name: 'Groceries',
  amount: '100000',
  currency: 'ARS',
  rollover: true,
  thresholds: [100, 80],
  categoryIds: [FOOD, BREAD, FUN],
  coveredCategoryIds: [FOOD, BREAD, FUN],
  effectiveFrom: '2026-10-01',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const spending = (overrides: Record<string, unknown> = {}) => ({
  budgetId: BUDGET_ID,
  name: 'Groceries',
  currency: 'ARS',
  month: '2026-10',
  amount: '100000',
  rolloverEnabled: true,
  rolloverAmount: '5000',
  available: '105000',
  spent: '40000',
  remaining: '65000',
  percentUsed: 38,
  thresholds: [80, 100],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
  ...overrides,
});

const category = (id: string, name: string, parentId: string | null = null) => ({
  id,
  kind: 'expense',
  parentId,
  key: null,
  name,
  icon: 'baby',
  color: 'blue',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const categories = () =>
  ok({
    items: [
      category(FOOD, 'Food'),
      category(BREAD, 'Bread', FOOD),
      category(FUN, 'Fun'),
      category(OTHER, 'Other'),
    ],
    total: 4,
    limit: 100,
    offset: 0,
  });

const routes = (overrides: Record<string, unknown> = {}) => ({
  [GET_BUDGET]: ok(budget()),
  [GET_SPENDING]: ok(spending()),
  [GET_CATEGORIES]: categories(),
  ...overrides,
});

const open = (
  locale: 'en' | 'es' = 'en',
  { id = BUDGET_ID, search = '' }: { id?: string; search?: string } = {},
) => renderApp(<BudgetDetailContainer budgetId={id} />, { locale, search });

describe('BudgetDetailContainer', () => {
  it('shows the figures, the covered categories by name and the thresholds (AC-11)', async () => {
    stubApi(routes());
    open();

    const progress = await screen.findByTestId('budget-progress');
    expect(progress.textContent).toContain('Groceries');
    expect(progress.textContent).toContain('spent:40000');
    expect(
      screen.getByText(en.budgets.detail.month.replace('{month}', 'October 2026')),
    ).toBeTruthy();
    const covered = screen.getByRole('list', { name: en.budgets.detail.categories });
    const top = within(covered)
      .getAllByRole('listitem')
      .filter((row) => row.parentElement === covered);
    expect(top.map((row) => row.firstElementChild?.textContent)).toEqual(['Food', 'Fun']);
    expect(within(top[0] as HTMLElement).getByText('Bread')).toBeTruthy();
    expect(within(covered).queryByText('Other')).toBeNull();
    const thresholds = screen.getByRole('list', { name: en.budgets.detail.thresholds });
    expect(within(thresholds).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: en.budgets.detail.edit }).getAttribute('href')).toBe(
      `/en/budgets/${BUDGET_ID}/edit`,
    );
    expect(screen.getByRole('link', { name: en.budgets.detail.back }).getAttribute('href')).toBe(
      '/en/budgets',
    );
    expect(screen.getByRole('button', { name: 'stub-delete' }).getAttribute('data-budget')).toBe(
      BUDGET_ID,
    );
  });

  it('shows a selected subcategory under its parent even when the parent is not selected (AC-11)', async () => {
    stubApi(routes({ [GET_BUDGET]: ok(budget({ categoryIds: [BREAD] })) }));
    open();

    const covered = await screen.findByRole('list', { name: en.budgets.detail.categories });
    const top = within(covered)
      .getAllByRole('listitem')
      .filter((row) => row.parentElement === covered);
    expect(top).toHaveLength(1);
    expect(top[0]?.firstElementChild?.textContent).toBe('Food');
    expect(within(top[0] as HTMLElement).getByText('Bread')).toBeTruthy();
    expect(within(covered).queryByText('Fun')).toBeNull();
  });

  it('lists a covered category the list does not name with the unavailable label (M1)', async () => {
    const GONE = '22222222-2222-4222-8222-222222222299';
    stubApi(routes({ [GET_BUDGET]: ok(budget({ categoryIds: [FOOD, GONE] })) }));
    open();

    const covered = await screen.findByRole('list', { name: en.budgets.detail.categories });
    expect(within(covered).getByText('Food')).toBeTruthy();
    expect(within(covered).getByText(en.budgets.form.categoryUnavailable)).toBeTruthy();
  });

  it('shows the not found state for a missing, foreign or not-yet-existing budget (AC-12)', async () => {
    stubApi(routes({ [GET_BUDGET]: notFound, [GET_SPENDING]: notFound }));
    open();

    expect(await screen.findByText(en.budgets.detail.notFound.title)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en.budgets.detail.notFound.back }).getAttribute('href'),
    ).toBe('/en/budgets');
  });

  it('shows the not found state when only the month has no version in force (AC-12)', async () => {
    stubApi(routes({ [GET_SPENDING]: notFound }));
    open();

    expect(await screen.findByText(en.budgets.detail.notFound.title)).toBeTruthy();
  });

  it('shows not found and sends no request for a malformed budget id (invalid input)', () => {
    const { calls } = stubApi(routes());
    open('en', { id: 'not-a-uuid' });

    expect(screen.getByText(en.budgets.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('sends the month of the query when it is valid', async () => {
    const { calls } = stubApi(
      routes({ [`${GET_SPENDING}?month=2026-08`]: ok(spending({ month: '2026-08' })) }),
    );
    open('en', { search: 'month=2026-08' });

    await screen.findByTestId('budget-progress');
    expect(calls.map((call) => call.path)).toContain(
      `/budgets/${BUDGET_ID}/spending?month=2026-08`,
    );
    expect(
      screen.getByText(en.budgets.detail.month.replace('{month}', 'August 2026')),
    ).toBeTruthy();
  });

  it('falls back to the current month for a malformed month (invalid input)', async () => {
    const { calls } = stubApi(routes());
    open('en', { search: 'month=2026-13' });

    await screen.findByTestId('budget-progress');
    expect(calls.map((call) => call.path)).toContain(`/budgets/${BUDGET_ID}/spending`);
    expect(calls.some((call) => call.path.includes('month='))).toBe(false);
  });

  it('shows the unconverted shares notice with its count (AC-13)', async () => {
    stubApi(routes({ [GET_SPENDING]: ok(spending({ unconvertedShareCount: 3 })) }));
    open();

    await screen.findByTestId('budget-progress');
    expect(
      screen.getByText(/^3 group shares or card installments could not be converted/),
    ).toBeTruthy();
  });

  it('shows the notice with the count of 1 installment not converted (AC-27)', async () => {
    stubApi(routes({ [GET_SPENDING]: ok(spending({ unconvertedInstallmentCount: 1 })) }));
    open();

    await screen.findByTestId('budget-progress');
    expect(
      screen.getByText(/^1 group share or card installment could not be converted/),
    ).toBeTruthy();
  });

  it('adds shares and installments left out into one count (AC-27)', async () => {
    stubApi(
      routes({
        [GET_SPENDING]: ok(spending({ unconvertedShareCount: 2, unconvertedInstallmentCount: 3 })),
      }),
    );
    open();

    await screen.findByTestId('budget-progress');
    expect(screen.getByText(/^5 group shares or card installments/)).toBeTruthy();
  });

  it.each([
    ['en', en],
    ['es', es],
  ] as const)('shows the card purchases note in %s (AC-13)', async (locale, catalog) => {
    stubApi(routes());
    open(locale);

    await screen.findByTestId('budget-progress');
    expect(screen.getByText(catalog.cardPurchasesNote.text)).toBeTruthy();
  });

  it('shows the failure state, not a notice, when the response lacks the installment count (AC-27)', async () => {
    const legacy: Record<string, unknown> = spending({ unconvertedShareCount: 2 });
    delete legacy['unconvertedInstallmentCount'];
    stubApi(routes({ [GET_SPENDING]: ok(legacy) }));
    open();

    expect(await screen.findByRole('button', { name: en.app.retry })).toBeTruthy();
    expect(screen.queryByTestId('budget-progress')).toBeNull();
    expect(screen.queryByText(/could not be converted/)).toBeNull();
  });

  it('shows no unconverted shares notice at 0 (AC-14)', async () => {
    stubApi(routes());
    open();

    await screen.findByTestId('budget-progress');
    expect(screen.queryByText(/could not be converted/)).toBeNull();
  });

  it('makes exactly 3 requests: the budget, its spending and the categories (NFR-02)', async () => {
    const { calls } = stubApi(routes());
    open();

    await screen.findByTestId('budget-progress');
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(
      [
        GET_BUDGET,
        GET_SPENDING,
        'GET /categories?kind=expense&archived=false&limit=100&offset=0',
      ].sort(),
    );
  });

  it('shows the error state with a retry that loads again (AC-02)', async () => {
    const { calls } = stubApi(routes({ [GET_SPENDING]: [{ status: 500 }, ok(spending())] }));
    open();

    const retry = await screen.findByRole('button', { name: en.app.retry });
    expect(screen.queryByTestId('budget-progress')).toBeNull();
    await userEvent.click(retry);

    expect(await screen.findByTestId('budget-progress')).toBeTruthy();
    expect(calls.filter((call) => call.path === `/budgets/${BUDGET_ID}/spending`)).toHaveLength(2);
  });

  it('shows the error state when the categories fail to load (AC-02)', async () => {
    stubApi(routes({ [GET_CATEGORIES]: { status: 500 } }));
    open();

    expect(await screen.findByRole('button', { name: en.app.retry })).toBeTruthy();
    expect(screen.queryByTestId('budget-progress')).toBeNull();
  });

  it('shows the offline message when the load is offline (AC-29)', async () => {
    stubApi(routes({ [GET_BUDGET]: 'network-error', [GET_SPENDING]: 'network-error' }));
    open();

    expect(await screen.findByText(en.errors.network)).toBeTruthy();
  });

  it('goes to the list after the budget is deleted', async () => {
    stubApi(routes());
    const { router } = open();

    await userEvent.click(await screen.findByRole('button', { name: 'stub-delete' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/budgets');
    });
  });

  it('has 44 px targets and labeled controls (NFR-06)', async () => {
    stubApi(routes());
    open();

    await screen.findByTestId('budget-progress');
    for (const name of [en.budgets.detail.edit, en.budgets.detail.back]) {
      expect(screen.getByRole('link', { name }).className).toMatch(/\bmin-h-11\b/);
    }
    expect(screen.getByRole('list', { name: en.budgets.detail.categories })).toBeTruthy();
    expect(screen.getByRole('list', { name: en.budgets.detail.thresholds })).toBeTruthy();
  });

  it('renders Spanish strings, amounts and months (AC-30)', async () => {
    stubApi(routes({ [GET_SPENDING]: ok(spending({ unconvertedShareCount: 1 })) }));
    open('es');

    await screen.findByTestId('budget-progress');
    expect(
      screen.getByText(es.budgets.detail.month.replace('{month}', 'octubre de 2026')),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: es.budgets.detail.edit })).toBeTruthy();
    expect(screen.getByRole('list', { name: es.budgets.detail.categories })).toBeTruthy();
    expect(
      screen.getByText(/^1 parte de grupo o cuota de tarjeta no se pudo convertir/),
    ).toBeTruthy();
  });
});
