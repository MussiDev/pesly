// @vitest-environment happy-dom
import { fireEvent, screen, within } from '@testing-library/react';
import type { CategoryDetailItem, CategoryDetailResponse } from '@pesly/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addMonth,
  isMonth,
  monthRange,
} from '../src/features/category-spending/category-spending-month';
import { CategorySpendingContainer } from '../src/features/category-spending/category-spending-container';
import { CategorySpendingScreen } from '../src/features/category-spending/category-spending-screen';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp } from './support/render-app';

const { es } = CATALOGS;
const FOOD = '00000000-0000-4000-8000-000000000001';
const GROCERIES = '00000000-0000-4000-8000-000000000002';
const MOVEMENT = '00000000-0000-4000-8000-000000000003';
const CARD = '00000000-0000-4000-8000-000000000004';
const GROUP = '00000000-0000-4000-8000-000000000005';

const BASE: Omit<CategoryDetailItem, 'key' | 'source' | 'day' | 'originalAmount' | 'amount'> = {
  dueDate: null,
  label: null,
  category: { id: FOOD, name: 'Comida', defaultKey: null },
  currency: 'ARS',
  movementId: null,
  cardId: null,
  installment: null,
  group: null,
};

function detail(patch: Partial<CategoryDetailResponse> = {}): CategoryDetailResponse {
  return {
    currency: 'ARS',
    month: '2026-10',
    categoryId: FOOD,
    name: 'Comida',
    defaultKey: null,
    total: '4580000',
    items: [
      {
        ...BASE,
        key: 'movement:a',
        source: 'movement',
        day: '2026-10-05',
        category: { id: GROCERIES, name: 'Súper', defaultKey: null },
        originalAmount: '150000',
        amount: '150000',
        movementId: MOVEMENT,
      },
      {
        ...BASE,
        key: 'movement:b',
        source: 'movement',
        day: '2026-10-03',
        label: 'Almuerzo',
        currency: 'USD',
        originalAmount: '2000',
        amount: '2800000',
        movementId: MOVEMENT,
      },
      {
        ...BASE,
        key: 'card:c',
        source: 'cardPurchase',
        day: '2026-09-15',
        dueDate: '2026-10-09',
        originalAmount: '300000',
        amount: '300000',
        movementId: MOVEMENT,
      },
      {
        ...BASE,
        key: 'installment:d:1',
        source: 'installment',
        day: '2026-09-10',
        dueDate: '2026-10-09',
        originalAmount: '500000',
        amount: '500000',
        cardId: CARD,
        installment: { number: 1, count: 4 },
      },
      {
        ...BASE,
        key: 'share:e',
        source: 'share',
        day: '2026-10-04',
        label: 'Cena',
        category: null,
        originalAmount: '700000',
        amount: '700000',
        group: { id: GROUP, name: 'Viaje' },
      },
    ],
    unconvertedShareCount: 1,
    unconvertedInstallmentCount: 0,
    ...patch,
  };
}

function norm(text: string | null): string {
  return (text ?? '').replace(/\s/g, ' ');
}

function money(value: bigint): string {
  return norm(formatMoney(value, 'ARS', 'es'));
}

function render(state: Parameters<typeof CategorySpendingScreen>[0]['state'], onRetry = vi.fn()) {
  renderApp(
    <CategorySpendingScreen
      locale="es"
      categoryId={FOOD}
      month="2026-10"
      state={state}
      onRetry={onRetry}
    />,
    { locale: 'es' },
  );
  return { onRetry };
}

describe('CategorySpendingScreen', () => {
  it('heads with the category, the dashboard total and what each source adds', () => {
    render({ status: 'ready', data: detail() });

    expect(screen.getByRole('heading', { level: 1, name: 'Comida' })).toBeDefined();
    const summary = screen.getByRole('region', { name: es.categorySpending.summary });
    expect(norm(summary.textContent)).toContain(money(4580000n));
    const sources = within(summary)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(sources).toEqual([
      es.categorySpending.sources.movement,
      es.categorySpending.sources.cardPurchase,
      es.categorySpending.sources.installment,
      es.categorySpending.sources.share,
    ]);
    // Movements: 150,000 + 2,800,000 converted.
    expect(norm(within(summary).getAllByRole('definition')[0]?.textContent ?? '')).toBe(
      money(2950000n),
    );
    expect(summary.textContent).toContain(es.categorySpending.howCounted);
    expect(summary.textContent).toContain('1 gasto en otra moneda no tiene cotización');
  });

  it('lists every item with where it comes from and opens it', () => {
    render({ status: 'ready', data: detail() });

    const links = screen.getAllByRole('link').filter((link) => link.closest('li') !== null);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/es/movements/edit?id=${MOVEMENT}`,
      `/es/movements/edit?id=${MOVEMENT}`,
      `/es/movements/edit?id=${MOVEMENT}`,
      `/es/cards/${CARD}`,
      `/es/groups/${GROUP}`,
    ]);
    const text = links.map((link) => norm(link.textContent));
    // A movement without a note shows its subcategory.
    expect(text[0]).toContain('Súper');
    // A foreign movement shows the converted amount and the original.
    expect(text[1]).toContain('Almuerzo');
    expect(text[1]).toContain(norm(formatMoney(2000n, 'USD', 'es')));
    expect(text[2]).toContain('Compra con tarjeta del 15 sept');
    expect(text[2]).toContain('vence el 9 oct');
    expect(text[3]).toContain('Cuota 1 de 4');
    expect(text[4]).toContain('Tu parte en Viaje');
  });

  it('links to the movements of the month and to the next and previous month', () => {
    render({ status: 'ready', data: detail() });

    expect(
      screen.getByRole('link', { name: es.categorySpending.viewMovements }).getAttribute('href'),
    ).toBe(`/es/movements?type=expense&categoryId=${FOOD}&from=2026-10-01&to=2026-10-31`);
    expect(
      screen.getByRole('link', { name: es.categorySpending.nextMonth }).getAttribute('href'),
    ).toBe(`/es/categories/spending?id=${FOOD}&month=2026-11`);
    expect(
      screen.getByRole('link', { name: es.categorySpending.previousMonth }).getAttribute('href'),
    ).toBe(`/es/categories/spending?id=${FOOD}&month=2026-09`);
  });

  it('says so when the month has nothing', () => {
    render({ status: 'ready', data: detail({ items: [], total: '0', unconvertedShareCount: 0 }) });
    expect(screen.getByText(es.categorySpending.empty)).toBeDefined();
    expect(screen.queryByRole('term')).toBeNull();
  });

  it('shows the loading, failed, offline and not found states', () => {
    const { onRetry } = render({ status: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: es.categorySpending.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each([
    ['loading', es.categorySpending.loading],
    ['offline', es.categorySpending.offline],
    ['notFound', es.categorySpending.notFound],
  ] as const)('shows the %s state', (status, text) => {
    render({ status });
    expect(screen.getByText(text)).toBeDefined();
  });
});

describe('category spending months', () => {
  it('validates, moves across years and gives the month range', () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth(null)).toBe(false);
    expect(addMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonth('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('CategorySpendingContainer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(status: number, body: unknown) {
    const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('loads the category and month of the address', async () => {
    const fetch = stub(200, detail());
    renderApp(<CategorySpendingContainer />, { search: `?id=${FOOD}&month=2026-10` });

    expect(await screen.findByRole('heading', { level: 1, name: 'Comida' })).toBeDefined();
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      `/reports/category-detail?categoryId=${FOOD}&month=2026-10`,
    );
  });

  it('answers not found for a malformed address without asking the server', () => {
    const fetch = stub(200, detail());
    renderApp(<CategorySpendingContainer />, { search: '?id=nope&month=2026-10' });

    expect(screen.getByText(es.categorySpending.notFound)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers not found for a category the server does not know', async () => {
    stub(404, { code: 'NOT_FOUND', message: 'Not found' });
    renderApp(<CategorySpendingContainer />, { search: `?id=${FOOD}&month=2026-10` });

    expect(await screen.findByText(es.categorySpending.notFound)).toBeDefined();
  });
});
