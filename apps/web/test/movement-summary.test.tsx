// @vitest-environment happy-dom
import type { CategoryResponse, MovementSummaryRow } from '@pesly/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import {
  MovementSummary,
  type MovementSummaryProps,
} from '../src/features/movements/components/movement-summary';
import { periodOf, periodRange } from '../src/features/movements/movement-period';
import { movementSummaryView } from '../src/features/movements/movement-summary-view';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const FOOD = uuid(1);
const GROCERIES = uuid(2);
const RESTAURANTS = uuid(3);
const TRANSPORT = uuid(4);
const SALARY = uuid(5);

function category(overrides: Partial<CategoryResponse> & { id: string }): CategoryResponse {
  return {
    kind: 'expense',
    parentId: null,
    key: null,
    name: 'Categoría',
    icon: 'receipt',
    color: 'blue',
    archived: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CATEGORIES = [
  category({ id: FOOD, name: 'Comida', icon: 'utensils', color: 'orange' }),
  category({ id: GROCERIES, name: 'Súper', parentId: FOOD }),
  category({ id: RESTAURANTS, name: 'Restaurantes', parentId: FOOD }),
  category({ id: TRANSPORT, name: 'Transporte' }),
  category({ id: SALARY, name: 'Sueldo', kind: 'income' }),
];

function row(
  categoryId: string | null,
  amount: string,
  overrides: Partial<MovementSummaryRow> = {},
): MovementSummaryRow {
  return { categoryId, currency: 'ARS', type: 'expense', amount, count: 1, ...overrides };
}

const ROWS = [
  row(GROCERIES, '300000', { count: 3 }),
  row(RESTAURANTS, '100000'),
  row(TRANSPORT, '200000', { count: 2 }),
  row(TRANSPORT, '1500', { currency: 'USD' }),
  row(SALARY, '900000', { type: 'income' }),
];

describe('periodRange and periodOf', () => {
  it('turns the quick ranges into local days of the user calendar', () => {
    expect(periodRange('all', '2026-10-30')).toEqual({ from: undefined, to: undefined });
    expect(periodRange('thisMonth', '2026-10-30')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodRange('lastMonth', '2026-10-30')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    // Across a year and through a leap February.
    expect(periodRange('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('thisMonth', '2028-02-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('recognizes a quick range in the filters and calls anything else custom', () => {
    const today = '2026-10-30';
    expect(periodOf({}, today)).toBe('all');
    expect(periodOf({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe('thisMonth');
    expect(periodOf({ from: '2026-09-01', to: '2026-09-30' }, today)).toBe('lastMonth');
    expect(periodOf({ from: '2026-10-05' }, today)).toBe('custom');
    expect(periodOf({ from: '2026-10-01', to: '2026-10-15' }, today)).toBe('custom');
  });
});

describe('movementSummaryView', () => {
  const options = {
    language: 'es' as const,
    selectedCategoryId: undefined,
    breakdown: 'expense' as const,
  };

  it('adds up expenses and incomes per currency, pesos first, never across currencies', () => {
    const view = movementSummaryView(ROWS, CATEGORIES, options);

    expect(view.expense).toEqual([
      { currency: 'ARS', amount: 600000n },
      { currency: 'USD', amount: 1500n },
    ]);
    expect(view.income).toEqual([{ currency: 'ARS', amount: 900000n }]);
  });

  it('adds subcategories into their parent and sorts by the pesos spent', () => {
    const view = movementSummaryView(ROWS, CATEGORIES, options);

    // Shares of the pesos spent (400000 + 200000), in basis points.
    expect(view.categories.map((entry) => [entry.label, entry.count, entry.basisPoints])).toEqual([
      ['Comida', 4, 6666],
      ['Transporte', 3, 3333],
    ]);
    expect(view.leadCurrency).toBe('ARS');
    expect(view.breakdownTotal).toBe(600000n);
    expect(view.categories[1]?.amounts).toEqual([
      { currency: 'ARS', amount: 200000n },
      { currency: 'USD', amount: 1500n },
    ]);
  });

  it('shows each subcategory on its own once its parent is the chosen category', () => {
    const view = movementSummaryView(
      [row(GROCERIES, '300000'), row(RESTAURANTS, '100000'), row(FOOD, '50000')],
      CATEGORIES,
      { ...options, selectedCategoryId: FOOD },
    );

    expect(view.categories.map((entry) => entry.label)).toEqual([
      'Súper',
      'Restaurantes',
      'Comida',
    ]);
  });

  it('keeps a chosen subcategory as itself instead of its parent', () => {
    const view = movementSummaryView([row(GROCERIES, '300000')], CATEGORIES, {
      ...options,
      selectedCategoryId: GROCERIES,
    });

    expect(view.categories.map((entry) => entry.id)).toEqual([GROCERIES]);
  });

  it('breaks incomes down instead when asked, and keeps unknown categories without a name', () => {
    const view = movementSummaryView(
      [row(SALARY, '900000', { type: 'income' }), row(uuid(99), '5000', { type: 'income' })],
      CATEGORIES,
      { ...options, breakdown: 'income' },
    );

    expect(view.breakdown).toBe('income');
    expect(view.categories.map((entry) => [entry.id, entry.label])).toEqual([
      [SALARY, 'Sueldo'],
      [uuid(99), undefined],
    ]);
  });

  it('is empty, with no share to divide by, when nothing matches', () => {
    const view = movementSummaryView([], CATEGORIES, options);

    expect(view).toEqual({
      expense: [],
      income: [],
      breakdown: 'expense',
      leadCurrency: undefined,
      breakdownTotal: 0n,
      categories: [],
    });
  });

  it('measures the shares in dollars when nothing was in pesos', () => {
    const view = movementSummaryView(
      [
        row(TRANSPORT, '1500', { currency: 'USD' }),
        row(FOOD, '1000', { currency: 'USD', count: 4 }),
      ],
      CATEGORIES,
      options,
    );

    expect(view.leadCurrency).toBe('USD');
    expect(view.categories.map((entry) => [entry.label, entry.basisPoints])).toEqual([
      ['Transporte', 6000],
      ['Comida', 4000],
    ]);
  });
});

function summary(overrides: Partial<MovementSummaryProps> = {}) {
  const props: MovementSummaryProps = {
    locale: 'es',
    period: 'all',
    onPeriodChange: vi.fn(),
    state: {
      kind: 'ready',
      view: movementSummaryView(ROWS, CATEGORIES, {
        language: 'es',
        selectedCategoryId: undefined,
        breakdown: 'expense',
      }),
    },
    onSelectCategory: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  renderIntl(<MovementSummary {...props} />);
  return props;
}

describe('MovementSummary', () => {
  it('shows what was spent and earned and where it went', () => {
    summary();

    const region = screen.getByRole('region', { name: es.movements.summary.title });
    expect(within(region).getAllByText(es.movements.summary.spent).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(es.movements.summary.earned).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/6000,00/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/9000,00/).length).toBeGreaterThan(0);
    // The ring draws an arc per category and its legend prints the shares.
    expect(document.querySelectorAll('circle[data-segment]')).toHaveLength(2);
    expect(within(region).getByText('67%')).toBeDefined();
    expect(
      within(region).getByRole('heading', { name: es.movements.summary.byCategory }),
    ).toBeDefined();
    expect(within(region).getByText('4 movimientos')).toBeDefined();
  });

  it('filters by a category when its row is chosen', async () => {
    const props = summary();

    await userEvent.click(screen.getByRole('button', { name: 'Ver solo Transporte' }));

    expect(props.onSelectCategory).toHaveBeenCalledWith(TRANSPORT);
  });

  it('heads a chosen category with its total and count, and goes back to every category', async () => {
    const onClearCategory = vi.fn();
    summary({
      selectedCategory: { id: FOOD, label: 'Comida' },
      onClearCategory,
      state: {
        kind: 'ready',
        view: movementSummaryView(
          [row(GROCERIES, '300000', { count: 2 }), row(RESTAURANTS, '100000')],
          CATEGORIES,
          { language: 'es', selectedCategoryId: FOOD, breakdown: 'expense' },
        ),
      },
    });

    expect(screen.getByRole('heading', { name: 'Comida' })).toBeDefined();
    expect(screen.getAllByText(es.movements.summary.categoryTotal).length).toBeGreaterThan(0);
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText(es.movements.summary.bySubcategory)).toBeDefined();
    // Each subcategory can still be opened on its own.
    expect(screen.getByRole('button', { name: 'Ver solo Súper' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: es.movements.summary.allCategories }));
    expect(onClearCategory).toHaveBeenCalledOnce();
  });

  it('offers no filter for movements without a category', () => {
    summary({
      state: {
        kind: 'ready',
        view: movementSummaryView([row(null, '2000')], CATEGORIES, {
          language: 'es',
          selectedCategoryId: undefined,
          breakdown: 'expense',
        }),
      },
    });

    expect(screen.getByText(es.movements.summary.uncategorized)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Ver solo/ })).toBeNull();
  });

  it('filters by a category from its arc as well as its row', () => {
    const props = summary();

    fireEvent.click(document.querySelector(`circle[data-segment="${TRANSPORT}"]`) as Element);

    expect(props.onSelectCategory).toHaveBeenCalledWith(TRANSPORT);
  });

  it('switches the breakdown between expenses and income', async () => {
    const onBreakdownChange = vi.fn();
    summary({ onBreakdownChange });

    const toggle = screen.getByRole('group', { name: es.movements.summary.breakdownKind });
    await userEvent.click(
      within(toggle).getByRole('button', { name: es.movements.summary.incomes }),
    );

    expect(onBreakdownChange).toHaveBeenCalledWith('income');
  });

  it('changes the period with the quick ranges and marks the current one', async () => {
    const props = summary({ period: 'thisMonth' });

    const group = screen.getByRole('group', { name: es.movements.summary.period });
    expect(
      within(group)
        .getByRole('button', { name: es.movements.summary.periods.thisMonth })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await userEvent.click(
      within(group).getByRole('button', { name: es.movements.summary.periods.lastMonth }),
    );

    expect(props.onPeriodChange).toHaveBeenCalledWith('lastMonth');
  });

  it('names a custom range without offering it as a choice', () => {
    summary({ period: 'custom' });

    const custom = screen.getByRole('button', { name: es.movements.summary.periods.custom });
    expect(custom.hasAttribute('disabled')).toBe(true);
  });

  it('lists five categories, then all of them on request', async () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => category({ id: uuid(10 + n), name: `Cat ${n}` }));
    summary({
      state: {
        kind: 'ready',
        view: movementSummaryView(
          many.map((entry, index) => row(entry.id, String((index + 1) * 1000))),
          many,
          { language: 'es', selectedCategoryId: undefined, breakdown: 'expense' },
        ),
      },
    });

    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Ver las 7 categorías' });
    await userEvent.click(toggle);
    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(7);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: es.movements.summary.showLess }));
    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(5);
  });

  it('shows zero pesos and a note when nothing matches', () => {
    summary({
      state: {
        kind: 'ready',
        view: {
          expense: [],
          income: [],
          breakdown: 'income',
          leadCurrency: undefined,
          breakdownTotal: 0n,
          categories: [],
        },
      },
    });

    expect(screen.getAllByText(/0,00/)).toHaveLength(2);
    expect(screen.getByText(es.movements.summary.empty)).toBeDefined();
  });

  it('announces the loading state and offers a retry when the totals fail', async () => {
    summary({ state: { kind: 'loading' } });
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    cleanup();

    const props = summary({ state: { kind: 'failed' } });
    expect(screen.getByText(es.movements.summary.failed)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: es.movements.summary.retry }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('speaks English with the English catalog', () => {
    renderIntl(
      <MovementSummary
        locale="en"
        period="all"
        onPeriodChange={vi.fn()}
        state={{ kind: 'failed' }}
        onSelectCategory={vi.fn()}
        onRetry={vi.fn()}
      />,
      'en',
    );

    expect(screen.getByText(en.movements.summary.failed)).toBeDefined();
    expect(
      screen.getByRole('button', { name: en.movements.summary.periods.thisMonth }),
    ).toBeDefined();
  });
});
