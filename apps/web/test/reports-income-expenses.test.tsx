// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { IncomeExpensesContainer } from '../src/features/reports/income-expenses/income-expenses-container';
import { formatMoney } from '../src/lib/format-amount';
import { renderApp, stubApi } from './support/render-app';

afterEach(() => {
  vi.restoreAllMocks();
});

const PATH = '/en/reports/income-expenses';
const REPORT = 'GET /reports/income-expenses';

function viewport(compact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: compact,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

interface MonthSeed {
  month: string;
  income: string;
  expenses: string;
}

/** `count` consecutive months from `start` (a `YYYY-MM`), each with the same figures. */
function months(start: string, count: number, income = '100000', expenses = '40000'): MonthSeed[] {
  const [year, month] = start.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const total = year * 12 + (month - 1) + index;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return { month: `${String(y)}-${String(m).padStart(2, '0')}`, income, expenses };
  });
}

function answer(
  list: MonthSeed[],
  extra: { shares?: number; installments?: number; currency?: 'ARS' | 'USD' } = {},
) {
  return {
    status: 200,
    body: {
      currency: extra.currency ?? 'ARS',
      from: '2025-11-01',
      to: '2026-10-31',
      months: list,
      unconvertedShareCount: extra.shares ?? 0,
      unconvertedInstallmentCount: extra.installments ?? 0,
    },
  };
}

function show(
  routes: Parameters<typeof stubApi>[0],
  options: { search?: string; locale?: 'en' | 'es' } = {},
) {
  viewport(false);
  const api = stubApi(routes);
  const app = renderApp(<IncomeExpensesContainer />, {
    locale: options.locale ?? 'en',
    pathname: PATH,
    search: options.search ?? '',
  });
  return { ...api, ...app };
}

/** `getByText` collapses the non-breaking space of money text, so the expected text is collapsed too. */
const NBSP = String.fromCharCode(0xa0);
const plain = (text: string) => text.replaceAll(NBSP, ' ');

const bars = (kind: 'income' | 'expenses') => document.querySelectorAll(`svg [data-bar="${kind}"]`);

const reportCalls = (calls: { path: string }[]) =>
  calls.filter((call) => call.path.startsWith('/reports/income-expenses'));

describe('IncomeExpensesContainer', () => {
  it('draws 12 income bars and 12 expense bars with month names in the language (AC-15)', async () => {
    show({ [REPORT]: answer(months('2025-11', 12)) }, { locale: 'es' });
    const list = await screen.findByRole('list', { name: es.reports.incomeExpenses.listName });
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(bars('income')).toHaveLength(12);
    expect(bars('expenses')).toHaveLength(12);
    expect(within(list).getByText(/octubre/i)).toBeDefined();
    expect(within(list).getByText(/noviembre/i)).toBeDefined();
  });

  it('shows +560,000.00 for 800,000.00 income against 240,000.00 expenses (AC-16)', async () => {
    show({ [REPORT]: answer([{ month: '2026-10', income: '80000000', expenses: '24000000' }]) });
    const list = await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(within(list).getByText(plain(`+${formatMoney(56000000n, 'ARS', 'en')}`))).toBeDefined();
    expect(
      within(list).getByText((content) =>
        content.includes(plain(formatMoney(80000000n, 'ARS', 'en'))),
      ),
    ).toBeDefined();
  });

  it('shows a minus sign when expenses are above income (AC-16)', async () => {
    show({ [REPORT]: answer([{ month: '2026-10', income: '100000', expenses: '350000' }]) });
    const list = await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(within(list).getByText(plain(`−${formatMoney(250000n, 'ARS', 'en')}`))).toBeDefined();
    expect(within(list).queryByText(/^\+/)).toBeNull();
  });

  it('shows the empty state and no bars when every month is at 0 (AC-17)', async () => {
    show({ [REPORT]: answer(months('2025-11', 12, '0', '0')) });
    expect(await screen.findByText(en.reports.states.emptyTitle)).toBeDefined();
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: en.reports.incomeExpenses.listName })).toBeNull();
  });

  it('offers no last-24 preset (AC-29)', async () => {
    show({ [REPORT]: answer(months('2025-11', 12)) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const group = screen.getByRole('group', { name: en.reports.range.label });
    expect(
      within(group).getByRole('button', { name: en.reports.range.presets.last12 }),
    ).toBeDefined();
    expect(
      within(group).queryByRole('button', { name: en.reports.range.presets.last24 }),
    ).toBeNull();
  });

  it('refuses 13 months with the 12-month limit and sends no request (AC-33)', async () => {
    const { calls } = show(
      { [REPORT]: answer(months('2025-11', 12)) },
      { search: 'from=2025-01-01&to=2026-01-31' },
    );
    expect(await screen.findByText(/limit is 12 months/)).toBeDefined();
    expect(reportCalls(calls)).toHaveLength(0);
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(0);
  });

  it('offers the account selector and the tag input (AC-24)', async () => {
    show({ [REPORT]: answer(months('2025-11', 12)) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(screen.getByLabelText(en.reports.filters.account)).toBeDefined();
    expect(screen.getByLabelText(en.movements.tags.label)).toBeDefined();
  });

  it('sends the tag filter and shows the filtered notice only with a filter (AC-38, AC-39)', async () => {
    const filtered = show(
      { [REPORT + '?tag=vacations2026']: answer(months('2025-11', 3)) },
      { search: 'tag=vacations2026' },
    );
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(screen.getByText(en.reports.notices.filtered)).toBeDefined();
    expect(reportCalls(filtered.calls).map((call) => call.path)).toEqual([
      '/reports/income-expenses?tag=vacations2026',
    ]);
  });

  it('does not show the filtered notice without a filter (AC-39)', async () => {
    show({ [REPORT]: answer(months('2025-11', 3)) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(screen.queryByText(en.reports.notices.filtered)).toBeNull();
  });

  it('shows the unconverted notice for 2 shares and 1 installment (AC-37)', async () => {
    show({ [REPORT]: answer(months('2025-11', 3), { shares: 2, installments: 1 }) });
    expect(await screen.findByText(/2 group shares and 1 installment\./)).toBeDefined();
  });

  it('shows no unconverted notice for 0 and 0 (AC-37)', async () => {
    show({ [REPORT]: answer(months('2025-11', 3)) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(screen.queryByText(/Left out because they have no exchange rate/)).toBeNull();
  });

  it('shows the currency note with the answer currency', async () => {
    show({ [REPORT]: answer(months('2025-11', 3), { currency: 'USD' }) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(screen.getByText(/Amounts are in USD/)).toBeDefined();
  });

  it('carries the same figures in the list and in the chart summary (AC-45, AC-46)', async () => {
    show({ [REPORT]: answer(months('2025-11', 12)) });
    const list = await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const figure = screen.getByRole('figure', { name: en.reports.incomeExpenses.chartName });
    expect(within(figure).getByText(/From .* to .*, 12 months\./)).toBeDefined();
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(bars('income')).toHaveLength(12);
    expect(figure.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Every month's net result is in the drawing and in the list.
    const net = formatMoney(60000n, 'ARS', 'en');
    expect(within(list).getAllByText(plain(`+${net}`))).toHaveLength(12);
  });

  it('thins the month labels at 24 months without drawing them all (NFR-08)', async () => {
    show({ [REPORT]: answer(months('2024-11', 24)) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const labels = document.querySelectorAll('svg text[data-month-label]');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(24);
    expect(bars('income')).toHaveLength(24);
  });

  it('draws at most 24 months even when more arrive', async () => {
    show({ [REPORT]: answer(months('2024-01', 26)) });
    const list = await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    expect(within(list).getAllByRole('listitem')).toHaveLength(24);
    expect(bars('expenses')).toHaveLength(24);
  });

  it('keeps the order received', async () => {
    show({
      [REPORT]: answer([
        { month: '2026-03', income: '100', expenses: '0' },
        { month: '2026-01', income: '100', expenses: '0' },
      ]),
    });
    const list = await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]?.textContent).toMatch(/March/);
    expect(items[1]?.textContent).toMatch(/January/);
  });

  it('renders the language in Spanish: labels, notice and amount format (AC-49)', async () => {
    show(
      {
        [REPORT + '?tag=viaje']: answer([
          { month: '2026-10', income: '80000000', expenses: '24000000' },
        ]),
      },
      { locale: 'es', search: 'tag=viaje' },
    );
    const list = await screen.findByRole('list', { name: es.reports.incomeExpenses.listName });
    expect(within(list).getByText(plain(`+${formatMoney(56000000n, 'ARS', 'es')}`))).toBeDefined();
    expect(screen.getByText(es.reports.notices.filtered)).toBeDefined();
  });

  it('shows the offline message and no figures when offline (AC-43)', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { calls } = show({ [REPORT]: answer(months('2025-11', 12)) });
    expect(await screen.findByText(en.reports.states.offlineTitle)).toBeDefined();
    expect(reportCalls(calls)).toHaveLength(0);
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: en.reports.incomeExpenses.listName })).toBeNull();
  });

  it('shows the error state with retry and no figures when the request fails (AC-42)', async () => {
    show({ [REPORT]: [{ status: 500 }, answer(months('2025-11', 2))] });
    const retry = await screen.findByRole('button', { name: en.reports.states.retry });
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(0);
    await userEvent.click(retry);
    expect(
      await screen.findByRole('list', { name: en.reports.incomeExpenses.listName }),
    ).toBeDefined();
  });

  it('shows the filter-gone alert on a 404 and clears the filters on reload (AC-27)', async () => {
    const { router } = show(
      { [REPORT + '?tag=gone']: { status: 404, body: { code: 'NOT_FOUND' } } },
      { search: 'tag=gone' },
    );
    expect(await screen.findByText(en.reports.states.filterGoneMessage)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: en.reports.states.filterGoneReload }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    const target = router.replace.mock.calls[0]?.[0] ?? '';
    expect(target).toContain('/reports/income-expenses');
    expect(target).not.toContain('tag=');
  });

  it('shows the range alert when the server refuses a date', async () => {
    show(
      {
        [REPORT + '?from=2026-01-01']: {
          status: 400,
          body: { code: 'VALIDATION_FAILED', fields: ['query.from'] },
        },
      },
      { search: 'from=2026-01-01' },
    );
    expect(await screen.findByText(en.reports.states.badRangeMessage)).toBeDefined();
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(0);
  });

  it('does not rely on color alone: the expense bars use a pattern fill and the legend names both', async () => {
    show({ [REPORT]: answer([{ month: '2026-10', income: '1000', expenses: '400' }]) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const income = document.querySelector('svg [data-bar="income"]');
    const expenses = document.querySelector('svg [data-bar="expenses"]');
    expect(income?.getAttribute('fill')).toBeNull();
    expect(expenses?.getAttribute('fill')).toMatch(/^url\(#/);
    const svgText = Array.from(document.querySelectorAll('svg text')).map(
      (node) => node.textContent,
    );
    expect(svgText).toContain(en.reports.incomeExpenses.income);
    expect(svgText).toContain(en.reports.incomeExpenses.expenses);
  });

  it('scales bars by integer permille: the largest value fills the plot, the smaller one a share', async () => {
    show({ [REPORT]: answer([{ month: '2026-10', income: '1000', expenses: '250' }]) });
    await screen.findByRole('list', { name: en.reports.incomeExpenses.listName });
    const income = Number(
      document.querySelector('svg [data-bar="income"]')?.getAttribute('height'),
    );
    const expenses = Number(
      document.querySelector('svg [data-bar="expenses"]')?.getAttribute('height'),
    );
    expect(Number.isInteger(income)).toBe(true);
    expect(expenses * 4).toBeGreaterThanOrEqual(income - 4);
    expect(expenses * 4).toBeLessThanOrEqual(income + 4);
  });
});
