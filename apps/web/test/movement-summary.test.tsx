// @vitest-environment happy-dom
import type { CategoryResponse, MovementSummaryRow } from '@pesly/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
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

    expect(view.categories.map((entry) => [entry.label, entry.count, entry.share])).toEqual([
      ['Comida', 4, 100],
      ['Transporte', 3, 50],
    ]);
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

    expect(view).toEqual({ expense: [], income: [], breakdown: 'expense', categories: [] });
  });

  it('sorts USD-only categories after peso ones and draws no bar without a lead amount', () => {
    const view = movementSummaryView(
      [
        row(TRANSPORT, '1500', { currency: 'USD' }),
        row(FOOD, '1000', { currency: 'USD', count: 4 }),
      ],
      CATEGORIES,
      options,
    );

    expect(view.categories.map((entry) => [entry.label, entry.share])).toEqual([
      ['Transporte', 100],
      ['Comida', 66],
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
    expect(within(region).getByText(/6000,00/)).toBeDefined();
    expect(within(region).getByText(/9000,00/)).toBeDefined();
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

  it('does not offer the chosen category again, nor a row without a category', () => {
    summary({
      selectedCategoryId: FOOD,
      state: {
        kind: 'ready',
        view: movementSummaryView([row(FOOD, '1000'), row(null, '2000')], CATEGORIES, {
          language: 'es',
          selectedCategoryId: FOOD,
          breakdown: 'expense',
        }),
      },
    });

    expect(screen.queryByRole('button', { name: /Ver solo/ })).toBeNull();
    expect(screen.getByText(es.movements.summary.uncategorized)).toBeDefined();
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

  it('shows three categories, then all of them on request', async () => {
    const many = [1, 2, 3, 4, 5].map((n) => category({ id: uuid(10 + n), name: `Cat ${n}` }));
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

    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(3);
    const toggle = screen.getByRole('button', { name: 'Ver las 5 categorías' });
    await userEvent.click(toggle);
    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(5);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: es.movements.summary.showLess }));
    expect(screen.getAllByRole('button', { name: /Ver solo/ })).toHaveLength(3);
  });

  it('shows zero pesos and a note when nothing matches', () => {
    summary({
      state: {
        kind: 'ready',
        view: { expense: [], income: [], breakdown: 'income', categories: [] },
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
