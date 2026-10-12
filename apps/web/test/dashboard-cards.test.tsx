// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/lib/format-amount';
import { formatCalendarDate } from '../src/features/credit-cards/format-dates';
import { BudgetsCard } from '../src/features/dashboard/components/budgets-card';
import { CategoriesCard } from '../src/features/dashboard/components/categories-card';
import { GroupsCard } from '../src/features/dashboard/components/groups-card';
import { UpcomingCard } from '../src/features/dashboard/components/upcoming-card';
import type {
  BudgetView,
  CategoryView,
  UpcomingView,
} from '../src/features/dashboard/dashboard-view';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing row ${String(index)}`);
  return item;
}

function norm(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return norm(formatMoney(value, currency, locale));
}

const FOOD: CategoryView = { key: 'food', label: 'Food', amount: 12000000n, share: 60 };
const TRANSPORT: CategoryView = {
  key: 'transport',
  label: 'Transport',
  amount: 8000000n,
  share: 40,
};

function budget(over: Partial<BudgetView> & { id: string }): BudgetView {
  return {
    name: `Budget ${over.id}`,
    currency: 'ARS',
    percent: 50,
    status: 'on_track',
    href: `/budgets/${over.id}`,
    ...over,
  };
}

describe('CategoriesCard', () => {
  it('lists name, amount and whole share as text for each row (AC-15)', () => {
    renderApp(<CategoriesCard locale="en" currency="ARS" categories={[FOOD, TRANSPORT]} />, {
      locale: 'en',
    });
    const list = screen.getByRole('list', { name: en.dashboard.categories.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(norm(at(rows, 0).textContent)).toContain('Food');
    expect(norm(at(rows, 0).textContent)).toContain(money(12000000n, 'ARS', 'en'));
    expect(at(rows, 0).textContent).toContain('60%');
    expect(at(rows, 1).textContent).toContain('40%');
    const bar = at(rows, 0).querySelector<HTMLElement>('[data-slot="share-bar"]');
    expect(bar?.style.width).toBe('60%');
  });

  it('shows the no-spending message and no list for an empty list (AC-16)', () => {
    renderApp(<CategoriesCard locale="en" currency="ARS" categories={[]} />, { locale: 'en' });
    expect(screen.getByText(en.dashboard.categories.empty)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('falls back to a non-empty label for a row with an empty label (AC-48)', () => {
    renderApp(
      <CategoriesCard
        locale="en"
        currency="ARS"
        categories={[
          { key: 'zzz', label: '', amount: 100n, share: 100 },
          { key: 'custom', label: 'Pets', amount: 100n, share: 0 },
        ]}
      />,
      { locale: 'en' },
    );
    const rows = screen.getAllByRole('listitem');
    expect(at(rows, 0).textContent).toContain(en.dashboard.categories.other);
    expect(at(rows, 1).textContent).toContain('Pets');
  });

  it('wraps long names and keeps min-w-0 (invalid input)', () => {
    const longName = 'Very long category name '.repeat(8).trim();
    renderApp(
      <CategoriesCard
        locale="es"
        currency="USD"
        categories={[{ key: 'x', label: longName, amount: 1n, share: 100 }]}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row.textContent).toContain(longName);
    expect(row.innerHTML).toContain('min-w-0');
    expect(row.innerHTML).toContain('break-words');
  });
});

describe('BudgetsCard', () => {
  it('shows over, close and on track in the order received with their words (AC-17, NFR-04)', () => {
    renderApp(
      <BudgetsCard
        locale="en"
        budgets={[
          budget({ id: 'a', status: 'over', percent: 120 }),
          budget({ id: 'b', status: 'close', percent: 90 }),
          budget({ id: 'c', status: 'on_track', percent: 30 }),
        ]}
      />,
      { locale: 'en' },
    );
    const list = screen.getByRole('list', { name: en.dashboard.budgets.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('[data-slot="badge"]')?.textContent)).toEqual([
      'Over',
      'Close',
      'On track',
    ]);
    expect(at(rows, 0).textContent).toContain('120%');
    const link = within(at(rows, 0)).getByRole('link');
    expect(link.getAttribute('href')).toContain('/budgets/a');
    expect(link.className).toContain('min-h-11');
  });

  it('shows at most 3 budgets', () => {
    renderApp(
      <BudgetsCard locale="en" budgets={['a', 'b', 'c', 'd'].map((id) => budget({ id }))} />,
      { locale: 'en' },
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows a link to create a budget when there are none (AC-18)', () => {
    renderApp(<BudgetsCard locale="en" budgets={[]} />, { locale: 'en' });
    const link = screen.getByRole('link', { name: en.dashboard.budgets.create });
    expect(link.getAttribute('href')).toContain('/budgets/new');
    expect(link.className).toContain('min-h-11');
  });

  it('renders a budget over 100 percent with a bar clamped to the card and wrapped name', () => {
    renderApp(
      <BudgetsCard
        locale="es"
        budgets={[budget({ id: 'a', status: 'over', percent: 340, name: 'N'.repeat(120) })]}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row.textContent).toContain('340%');
    expect(row.textContent).toContain(es.dashboard.budgets.over);
    expect(row.innerHTML).toContain('min-w-0');
    expect(row.querySelector<HTMLElement>('[data-slot="share-bar"]')?.style.width).toBe('100%');
  });
});

describe('UpcomingCard', () => {
  const PAYMENT: UpcomingView = {
    kind: 'recurring_payment',
    href: '/recurring/p1',
    overdue: false,
    name: 'Rent',
    date: '2026-10-15',
    amount: 5000000n,
    currency: 'ARS',
  };
  const STATEMENT: UpcomingView = {
    kind: 'statement_due',
    href: '/cards/s1',
    overdue: false,
    name: 'Visa',
    date: '2026-10-18',
    amount: 12345n,
    currency: 'USD',
  };

  it('lists the entries in order with date, name and own-currency amount (AC-19)', () => {
    renderApp(<UpcomingCard locale="en" upcoming={[PAYMENT, STATEMENT]} />, { locale: 'en' });
    const list = screen.getByRole('list', { name: en.dashboard.upcoming.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const first = norm(at(rows, 0).textContent);
    expect(first).toContain('Rent');
    expect(first).toContain(formatCalendarDate('2026-10-15', 'en'));
    expect(first).toContain(money(5000000n, 'ARS', 'en'));
    const second = norm(at(rows, 1).textContent);
    expect(second).toContain('Visa');
    expect(second).toContain(money(12345n, 'USD', 'en'));
    expect(within(at(rows, 0)).getByRole('link').getAttribute('href')).toContain('/recurring/p1');
    expect(within(at(rows, 1)).getByRole('link').className).toContain('min-h-11');
  });

  it('shows the nothing-due message when empty (AC-20)', () => {
    renderApp(<UpcomingCard locale="en" upcoming={[]} />, { locale: 'en' });
    expect(screen.getByText(en.dashboard.upcoming.empty)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('falls back to the kind label and omits a missing amount (invalid input)', () => {
    renderApp(
      <UpcomingCard
        locale="en"
        upcoming={[
          { ...PAYMENT, name: null, amount: null, currency: null },
          { ...STATEMENT, name: '', amount: null, currency: null },
        ]}
      />,
      { locale: 'en' },
    );
    const rows = screen.getAllByRole('listitem');
    expect(at(rows, 0).textContent).toContain(en.dashboard.upcoming.payment);
    expect(at(rows, 0).textContent).not.toContain('ARS');
    expect(at(rows, 1).textContent).toContain(en.dashboard.upcoming.statement);
  });

  it('renders Spanish dates and amounts (AC-47)', () => {
    renderApp(<UpcomingCard locale="es" upcoming={[PAYMENT]} />);
    const row = norm(screen.getByRole('listitem').textContent);
    expect(row).toContain(formatCalendarDate('2026-10-15', 'es'));
    expect(row).toContain(money(5000000n, 'ARS', 'es'));
  });
});

describe('GroupsCard', () => {
  it('shows owed to you and you owe per currency with no difference (AC-25)', () => {
    renderApp(
      <GroupsCard
        locale="en"
        groups={{
          owedToYou: { ARS: 3000000n, USD: 0n },
          youOwe: { ARS: 0n, USD: 5000n },
        }}
      />,
      { locale: 'en' },
    );
    const owed = screen.getByRole('group', { name: en.dashboard.groups.owedToYou });
    const owe = screen.getByRole('group', { name: en.dashboard.groups.youOwe });
    expect(norm(owed.textContent)).toContain(money(3000000n, 'ARS', 'en'));
    expect(norm(owed.textContent)).toContain(money(0n, 'USD', 'en'));
    expect(norm(owe.textContent)).toContain(money(5000n, 'USD', 'en'));
    expect(norm(owe.textContent)).toContain(money(0n, 'ARS', 'en'));
    expect(money(0n, 'ARS', 'en')).toContain('0.00');
  });

  it('renders Spanish labels and separators (AC-47)', () => {
    renderApp(
      <GroupsCard
        locale="es"
        groups={{ owedToYou: { ARS: 3000000n, USD: 0n }, youOwe: { ARS: 0n, USD: 5000n } }}
      />,
    );
    const owed = screen.getByRole('group', { name: es.dashboard.groups.owedToYou });
    expect(norm(owed.textContent)).toContain(money(3000000n, 'ARS', 'es'));
    expect(money(0n, 'USD', 'es')).toContain('0,00');
  });
});
