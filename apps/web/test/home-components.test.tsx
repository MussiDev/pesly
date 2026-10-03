// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@pesly/shared';
import { BalanceSummary } from '../src/features/home/components/balance-summary';
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
  it('shows the available total and net worth per currency of the user accounts only', () => {
    renderApp(
      <BalanceSummary
        locale="es"
        currencies={['ARS']}
        availableTotals={{ ARS: '1234500', USD: '999' }}
        netWorthTotals={{ ARS: '1000000' }}
      />,
    );

    const group = screen.getByRole('group', { name: es.home.balance.currencies.ARS });
    expect(within(group).getByText(money(1234500n, 'ARS', 'es'))).toBeDefined();
    expect(within(group).getByText(money(1000000n, 'ARS', 'es'))).toBeDefined();
    expect(within(group).getByText(es.home.balance.available)).toBeDefined();
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.USD })).toBeNull();
  });

  it('renders figures in English and falls back to zero for a missing total', () => {
    renderApp(
      <BalanceSummary locale="en" currencies={['USD']} availableTotals={{}} netWorthTotals={{}} />,
      { locale: 'en' },
    );
    const group = screen.getByRole('group', { name: en.home.balance.currencies.USD });
    expect(within(group).getAllByText(money(0n, 'USD', 'en'))).toHaveLength(2);
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
    const group = within(screen.getByRole('group', { name: es.home.balance.currencies.ARS }));
    expect(group.getAllByText('—')).toHaveLength(2);
  });

  it('a malformed movement amount shows a placeholder and does not throw', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[{ ...ROW, amount: '2e5' }]} />);
    const row = within(screen.getByRole('listitem'));
    expect(row.getByText('—')).toBeDefined();
    expect(row.getByText('Sueldo')).toBeDefined();
  });
});

describe('QuickActions', () => {
  it('links to the new movement and the new account forms', () => {
    renderApp(<QuickActions />, { locale: 'en' });
    expect(
      screen.getByRole('link', { name: en.home.quickActions.addMovement }).getAttribute('href'),
    ).toBe('/en/movements/new');
    expect(
      screen.getByRole('link', { name: en.home.quickActions.addAccount }).getAttribute('href'),
    ).toBe('/en/accounts/new');
  });
});

describe('HomeScreen and HomeSkeleton', () => {
  it('the skeleton announces loading and occupies the same sections as the loaded home', () => {
    renderApp(<HomeSkeleton />);
    expect(screen.getByRole('status', { name: es.ui.loading })).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });

  it('the screen has one level-one heading and composes balance, movements and actions', () => {
    renderApp(
      <HomeScreen
        locale="es"
        timeZone="UTC"
        currencies={['ARS']}
        availableTotals={{ ARS: '100' }}
        netWorthTotals={{ ARS: '100' }}
        movements={[ROW]}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('group', { name: es.home.balance.currencies.ARS })).toBeDefined();
    expect(screen.getByRole('list', { name: es.home.recent.title })).toBeDefined();
    expect(screen.getByRole('link', { name: es.home.quickActions.addAccount })).toBeDefined();
  });
});
