// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@pesly/shared';
import { BalanceSummary } from '../src/features/home/components/balance-summary';
import { HomeAccounts } from '../src/features/home/components/home-accounts';
import { HomeScreen, HomeSkeleton } from '../src/features/home/components/home-screen';
import { QuickActions } from '../src/features/home/components/quick-actions';
import {
  RecentMovements,
  type RecentMovementItem,
} from '../src/features/home/components/recent-movements';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

/** The DOM matcher normalizes whitespace (non-breaking spaces included), so the needle must be too. */
function money(value: bigint, currency: string, locale: string): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

const ROW: RecentMovementItem = {
  id: 'm1',
  type: 'income',
  amount: '250000',
  currency: 'ARS',
  occurredAt: '2026-10-02T15:00:00.000Z',
  categoryName: 'Sueldo',
  categoryIcon: 'banknote',
  categoryColor: 'green',
  accountName: 'Caja',
};

describe('BalanceSummary', () => {
  it('shows net worth as the headline and the available total per currency of the user accounts only', () => {
    renderApp(
      <BalanceSummary
        locale="es"
        currencies={['ARS']}
        availableTotals={{ ARS: '1234500', USD: '999' }}
        netWorthTotals={{ ARS: '1000000' }}
      />,
    );

    const figuresOf = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('[data-slot="amount"]')).map((el) =>
        // The headline figure dims its cents in a nested span, so it is matched by its whole text.
        el.textContent.replace(/\s+/g, ' '),
      );
    const section = screen.getByRole('region', { name: es.home.balance.netWorth });
    const tile = screen.getByRole('group', { name: es.home.balance.currencies.ARS });
    expect(figuresOf(section)).toEqual([
      money(1000000n, 'ARS', 'es'),
      money(1234500n, 'ARS', 'es'),
    ]);
    expect(figuresOf(tile)).toEqual([money(1234500n, 'ARS', 'es')]);
    expect(
      within(tile).getByText(es.home.balance.tile.replace('{currency}', 'Pesos')),
    ).toBeDefined();
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.USD })).toBeNull();
  });

  it('renders figures in English and falls back to zero for a missing total', () => {
    renderApp(
      <BalanceSummary locale="en" currencies={['USD']} availableTotals={{}} netWorthTotals={{}} />,
      { locale: 'en' },
    );
    const section = screen.getByRole('region', { name: en.home.balance.netWorth });
    const figures = Array.from(section.querySelectorAll('[data-slot="amount"]')).map((el) =>
      el.textContent.replace(/\s+/g, ' '),
    );
    expect(figures).toEqual([money(0n, 'USD', 'en'), money(0n, 'USD', 'en')]);
  });
});

describe('RecentMovements', () => {
  it('shows each movement with category, account, direction and a link to see all', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[ROW]} />);

    const list = screen.getByRole('list', { name: es.home.recent.title });
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText('Sueldo')).toBeDefined();
    expect(within(row).getByText(/Caja/)).toBeDefined();
    expect(within(row).getByText(es.home.recent.income)).toBeDefined();
    expect(within(row).getByText(money(250000n, 'ARS', 'es'))).toBeDefined();
    expect(within(row).getByText('+')).toBeDefined();
    expect(screen.getByRole('link', { name: es.home.recent.seeAll }).getAttribute('href')).toBe(
      '/es/movements',
    );
  });

  it('uses neutral placeholders for an unknown category or account', () => {
    renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[
          {
            ...ROW,
            type: 'expense',
            currency: undefined,
            categoryName: undefined,
            accountName: undefined,
          },
        ]}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(within(row).getByText(es.home.recent.unknownCategory)).toBeDefined();
    expect(within(row).getByText(new RegExp(es.home.recent.unknownAccount))).toBeDefined();
    expect(within(row).getByText(es.home.recent.expense)).toBeDefined();
  });

  it('shows an unknown currency as a plain figure with its sign and no symbol', () => {
    renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[{ ...ROW, currency: undefined, accountName: undefined }]}
      />,
    );
    const row = within(screen.getByRole('listitem'));
    expect(row.getByText('2500,00')).toBeDefined();
    expect(row.getByText('+')).toBeDefined();
    expect(row.getByText(es.home.recent.income)).toBeDefined();
    expect(row.queryByText(/¤/)).toBeNull();
  });

  it('renders dates in UTC when the time zone is invalid', () => {
    renderApp(
      <RecentMovements
        locale="es"
        timeZone="Not/AZone"
        items={[{ ...ROW, occurredAt: '2026-10-05T01:30:00.000Z' }]}
      />,
    );
    // Still the 4th in Buenos Aires: only a UTC fallback shows the 5th.
    expect(screen.getByText('5 oct 2026')).toBeDefined();
  });

  it('shows the empty section with a call to action when there are no movements', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[]} />);
    expect(screen.getByRole('heading', { name: es.home.recent.empty.title })).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.home.recent.empty.action }).getAttribute('href'),
    ).toBe('/es/movements/new');
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('QuickActions (AC-13, AC-14)', () => {
  it('renders four circular actions, each linking to the new-movement screen with its type', () => {
    renderApp(<QuickActions />);

    const list = screen.getByRole('list', { name: es.home.quickActions.label });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/es/movements/new?type=expense',
      '/es/movements/new?type=income',
      '/es/movements/new?type=transfer',
      '/es/movements/new?type=exchange',
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      es.home.quickActions.expense,
      es.home.quickActions.income,
      es.home.quickActions.transfer,
      es.home.quickActions.exchange,
    ]);
    for (const link of links) {
      expect(link.querySelector('[data-slot="circular-action-circle"]')).not.toBeNull();
    }
  });

  it('names the actions in English', () => {
    renderApp(<QuickActions />, { locale: 'en' });

    expect(
      screen.getByRole('link', { name: en.home.quickActions.exchange }).getAttribute('href'),
    ).toBe('/en/movements/new?type=exchange');
  });
});

describe('HomeAccounts', () => {
  const ACCOUNTS = [
    { id: 'a1', name: 'Caja', currency: 'ARS', balance: '123450' },
    { id: 'a2', name: 'Dólares', currency: 'USD', balance: '25000' },
  ];

  it('lists each account with its currency and balance, and links to see them all', () => {
    renderApp(<HomeAccounts locale="es" accounts={ACCOUNTS} />);

    const list = screen.getByRole('list', { name: es.home.accounts.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Caja');
    expect(rows[0]?.textContent.replace(/\s+/g, ' ')).toContain(money(123450n, 'ARS', 'es'));
    expect(rows[1]?.textContent).toContain('Dólares');
    expect(screen.getByRole('link', { name: es.home.accounts.seeAll }).getAttribute('href')).toBe(
      '/es/accounts',
    );
  });

  it('error: a balance that is not an exact integer shows a placeholder and does not throw', () => {
    renderApp(
      <HomeAccounts
        locale="es"
        accounts={[{ id: 'a1', name: 'Rota', currency: 'ARS', balance: '12.5' }]}
      />,
    );

    expect(screen.getByRole('listitem').textContent).toContain('—');
  });

  it('error: with no accounts it renders nothing, because the home shows its empty state instead', () => {
    const { container } = renderApp(<HomeAccounts locale="es" accounts={[]} />);

    expect(container.textContent).toBe('');
  });
});

describe('RecentMovements logos (AC-21, AC-22, AC-23)', () => {
  it('shows the merchant logo of an expense whose note names a catalog merchant', () => {
    const { container } = renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[{ ...ROW, id: 'e1', type: 'expense', note: 'Spotify premium' }]}
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/spotify.svg');
  });

  it('keeps the category icon when the note names no catalog merchant', () => {
    const { container } = renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[
          { ...ROW, note: 'almuerzo con amigos' },
          { ...ROW, id: 'm2', note: null },
        ]}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('[data-icon="banknote"]')).toHaveLength(2);
  });

  it('shows the movement-type icon for a transfer and never a logo, even if the note names a merchant', () => {
    const { container } = renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[{ ...ROW, id: 't1', type: 'transfer', note: 'Netflix' }]}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="avatar"] svg')).not.toBeNull();
  });
});

describe('malformed API values', () => {
  it('a malformed balance total shows a placeholder and does not throw', () => {
    renderApp(
      <BalanceSummary
        locale="es"
        currencies={['ARS']}
        availableTotals={{ ARS: 'abc' }}
        netWorthTotals={{ ARS: '1.5' }}
      />,
    );
    const section = within(screen.getByRole('region', { name: es.home.balance.netWorth }));
    expect(section.getAllByText('—')).toHaveLength(2);
  });

  it('a malformed movement amount shows a placeholder and does not throw', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[{ ...ROW, amount: '2e5' }]} />);
    const row = within(screen.getByRole('listitem'));
    expect(row.getByText('—')).toBeDefined();
    expect(row.getByText('Sueldo')).toBeDefined();
  });
});

describe('HomeScreen and HomeSkeleton', () => {
  it('the skeleton announces loading and occupies the same sections as the loaded home', () => {
    renderApp(<HomeSkeleton />);
    expect(screen.getByRole('status', { name: es.ui.loading })).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });

  it('the screen has one level-one heading and composes balance, quick actions, accounts and movements', () => {
    renderApp(
      <HomeScreen
        locale="es"
        timeZone="UTC"
        currencies={['ARS']}
        availableTotals={{ ARS: '100' }}
        netWorthTotals={{ ARS: '100' }}
        accounts={[{ id: 'a1', name: 'Caja', currency: 'ARS', balance: '100' }]}
        movements={[ROW]}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('group', { name: es.home.balance.currencies.ARS })).toBeDefined();
    expect(screen.getByRole('list', { name: es.home.quickActions.label })).toBeDefined();
    expect(screen.getByRole('list', { name: es.home.accounts.title })).toBeDefined();
    expect(screen.getByRole('list', { name: es.home.recent.title })).toBeDefined();
    // Adding a movement lives in the shell's navigation: the home does not repeat it.
    expect(screen.queryByRole('link', { name: es.home.recent.empty.action })).toBeNull();
  });
});
