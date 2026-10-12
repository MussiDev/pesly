// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import CategoriesPage from '../src/app/[locale]/(app)/reports/categories/page';
import { CategoriesContainer } from '../src/features/reports/categories/categories-container';
import { renderApp, stubApi, type TestLocale } from './support/render-app';

const REPORT = 'GET /reports/expenses-by-category';
const ID_A = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const ID_B = '4f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11';
const ID_C = '5f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a12';
const ACCOUNT = '6f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a13';

interface Row {
  categoryId: string | null;
  name: string | null;
  defaultKey: string | null;
  amount: string;
}

function report(total: string, categories: Row[], extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      currency: 'ARS',
      from: '2026-10-01',
      to: '2026-10-12',
      total,
      categories,
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
      ...extra,
    },
  };
}

const food = (amount: string): Row => ({
  categoryId: ID_A,
  name: null,
  defaultKey: 'food',
  amount,
});
const transport = (amount: string): Row => ({
  categoryId: ID_B,
  name: null,
  defaultKey: 'transport',
  amount,
});
const named = (id: string, name: string, amount: string): Row => ({
  categoryId: id,
  name,
  defaultKey: null,
  amount,
});

function show(
  routes: Parameters<typeof stubApi>[0],
  options: { locale?: TestLocale; search?: string } = {},
) {
  const api = stubApi(routes);
  const app = renderApp(<CategoriesContainer />, {
    locale: options.locale ?? 'en',
    pathname: `/${options.locale ?? 'en'}/reports/categories`,
    search: options.search ?? '',
  });
  return { ...api, ...app };
}

const reportCalls = (calls: { method: string; path: string }[]) =>
  calls.filter((call) => call.path.startsWith('/reports/expenses-by-category'));

describe('categories screen', () => {
  it('shows the total with Food 60% first and Transport 40% second (AC-08)', async () => {
    show({ [REPORT]: report('20000000', [transport('8000000'), food('12000000')]) });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Food');
    expect(rows[0]?.textContent).toContain('60%');
    expect(rows[0]?.textContent).toContain('120,000.00');
    expect(rows[1]?.textContent).toContain('Transport');
    expect(rows[1]?.textContent).toContain('40%');
    expect(screen.getByText(/200,000\.00/, { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Showing Oct 1, 2026 to Oct 12, 2026')).toBeTruthy();
  });

  it('thirds show whole shares that add up to at most 100% (AC-09)', async () => {
    show({
      [REPORT]: report('300', [
        named(ID_A, 'A', '100'),
        named(ID_B, 'B', '100'),
        named(ID_C, 'C', '100'),
      ]),
    });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    const percents = within(list)
      .getAllByRole('listitem')
      .map((item) => Number(/(\d+)%/.exec(item.textContent)?.[1]));
    expect(percents.every((value) => Number.isInteger(value))).toBe(true);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(100);
  });

  it('a total of 0.00 shows the empty state and no percentage (AC-10)', async () => {
    show({ [REPORT]: report('0', []) });
    expect(await screen.findByText('No movements in this range')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Expenses by category' })).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('8 categories draw 6 ring segments and list 8 rows (AC-11)', async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      named(
        `7f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a1${index}`,
        `Cat ${index}`,
        String(800 - index * 10),
      ),
    );
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    const { container } = show({ [REPORT]: report(String(total), rows) });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(container.querySelectorAll('circle[data-segment]')).toHaveLength(6);
    expect(container.querySelector('circle[data-segment="rest"]')).not.toBeNull();
  });

  it('a share under 1% lists "<1%" with its amount (AC-12)', async () => {
    show({ [REPORT]: report('100001', [food('100000'), named(ID_B, 'Tiny', '1')]) });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    const tiny = within(list)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes('Tiny'));
    expect(tiny?.textContent).toContain('<1%');
    expect(tiny?.textContent).toContain('0.01');
  });

  it('names default keys in English and Spanish and the null id as group shares (AC-13, AC-14)', async () => {
    const rows = [
      food('600'),
      { categoryId: null, name: null, defaultKey: null, amount: '400' } satisfies Row,
    ];
    const en = show({ [REPORT]: report('1000', rows) });
    const enList = await screen.findByRole('list', { name: 'Expenses by category' });
    expect(enList.textContent).toContain('Food');
    expect(enList.textContent).toContain('Group shares');
    en.unmount();

    show({ [REPORT]: report('1000', rows) }, { locale: 'es' });
    const esList = await screen.findByRole('list', { name: 'Gastos por categoría' });
    expect(esList.textContent).toContain('Comida');
    expect(esList.textContent).toContain('Partes de grupo');
  });

  it('filtering by the tag vacations2026 requests the report with that tag (AC-26)', async () => {
    const { calls } = show(
      { [REPORT + '?tag=vacations2026']: report('500', [food('500')]) },
      { search: 'tag=vacations2026' },
    );
    expect(await screen.findByRole('list', { name: 'Expenses by category' })).toBeTruthy();
    expect(reportCalls(calls).map((call) => call.path)).toEqual([
      '/reports/expenses-by-category?tag=vacations2026',
    ]);
    expect(screen.getByText(/not part of a report filtered/)).toBeTruthy();
  });

  it('first open sends no from and no to; a preset sends explicit dates (AC-28)', async () => {
    const { calls, router } = show({ [REPORT]: report('500', [food('500')]) });
    await screen.findByRole('list', { name: 'Expenses by category' });
    expect(reportCalls(calls).map((call) => call.path)).toEqual(['/reports/expenses-by-category']);

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Last 3 months' }).disabled,
      ).toBe(false);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    const target = router.replace.mock.calls.at(-1)?.[0] ?? '';
    expect(target).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(target).toMatch(/to=\d{4}-\d{2}-\d{2}/);
  });

  it('with Spanish selected labels, notices and amounts are Spanish (AC-49)', async () => {
    show(
      {
        [REPORT]: report('20000000', [food('12000000'), transport('8000000')], {
          unconvertedShareCount: 2,
          unconvertedInstallmentCount: 1,
        }),
      },
      { locale: 'es' },
    );
    const list = await screen.findByRole('list', { name: 'Gastos por categoría' });
    expect(list.textContent).toContain('120.000,00');
    expect(screen.getByText(/Quedan afuera por no tener tipo de cambio/)).toBeTruthy();
    expect(screen.getByText(/^Mostrando del .* al .*$/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /perfil/i })).toBeTruthy();
  });

  it('renders a hostile category name as text and creates no element', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = show({
      [REPORT]: report('100', [named(ID_A, hostile, '100')]),
    });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    expect(list.textContent).toContain(hostile);
    expect(container.querySelector('img')).toBeNull();
  });

  it('the list has one row per category and the chart exposes a name and summary (AC-45, AC-46)', async () => {
    const { container } = show({
      [REPORT]: report('20000000', [food('12000000'), transport('8000000')]),
    });
    const list = await screen.findByRole('list', { name: 'Expenses by category' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    const figure = screen.getByRole('figure', { name: 'Expenses by category chart' });
    expect(figure.textContent).toContain('From Oct 1, 2026 to Oct 12, 2026, total expenses');
    expect(figure.textContent).toContain('200,000.00');
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('a failing request shows the error state with retry and no earlier figures', async () => {
    const { calls } = show({ [REPORT]: { status: 500 } });
    expect(await screen.findByText('The report could not be loaded')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Expenses by category' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => {
      expect(reportCalls(calls).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('a 404 for an account filter shows the filter-gone alert and clears the filters on reload (AC-27)', async () => {
    const { router } = show(
      {
        [`${REPORT}?from=2026-09-01&to=2026-09-30&accountId=${ACCOUNT}`]: {
          status: 404,
          body: { code: 'NOT_FOUND', message: 'x' },
        },
      },
      { search: `accountId=${ACCOUNT}&from=2026-09-01&to=2026-09-30` },
    );
    expect(
      await screen.findByText('The account or tag you filtered by no longer exists.'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the filters and reload' }));
    const target = router.replace.mock.calls.at(-1)?.[0] ?? '';
    expect(target).not.toContain('accountId');
    expect(target).toContain('from=2026-09-01');
  });

  it('the route page renders the container without its own main', async () => {
    stubApi({ [REPORT]: report('500', [food('500')]) });
    const { container } = renderApp(<CategoriesPage />, {
      locale: 'en',
      pathname: '/en/reports/categories',
    });
    expect(await screen.findByRole('list', { name: 'Expenses by category' })).toBeTruthy();
    expect(container.querySelector('main')).toBeNull();
  });
});
