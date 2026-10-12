// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HomeContainer } from '../src/features/home/containers/home-container';
import {
  RecentMovements,
  type RecentMovementItem,
} from '../src/features/home/components/recent-movements';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const ROW: RecentMovementItem = {
  id: 'm1',
  type: 'expense',
  amount: '250000',
  currency: 'ARS',
  occurredAt: '2026-10-02T15:00:00.000Z',
  note: 'Supermercado',
  categoryName: 'Comida',
  categoryIcon: 'utensils',
  categoryColor: 'orange',
  accountName: 'Caja',
};

describe('RecentMovements row links (AC-41, AC-42)', () => {
  it('renders one link per row to /movements?focus=<id> named by title plus the sr-only hint, and nothing else interactive', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[ROW, { ...ROW, id: 'm 2/x' }]} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    const link = first.getByRole('link');
    expect(link.getAttribute('href')).toBe('/es/movements?focus=m1');
    expect(link.textContent).toContain('Supermercado');
    expect(link.textContent).toContain(es.home.recent.openInMovements);
    expect(first.getAllByRole('link')).toHaveLength(1);
    expect(first.queryAllByRole('button')).toHaveLength(0);
    const second = within(rows[1] as HTMLElement).getByRole('link');
    expect(second.getAttribute('href')).toBe(`/es/movements?focus=${encodeURIComponent('m 2/x')}`);
  });

  it('is reachable and activated by keyboard', async () => {
    const user = userEvent.setup();
    renderApp(<RecentMovements locale="en" timeZone="UTC" items={[ROW]} />, { locale: 'en' });
    const link = screen.getByRole('link', { name: new RegExp(en.home.recent.openInMovements) });
    await user.tab();
    // The first tab stop is the "view all" link; the row link follows it.
    await user.tab();
    expect(document.activeElement).toBe(link);
    await user.keyboard('{Enter}');
    expect(link.getAttribute('href')).toBe('/en/movements?focus=m1');
  });

  it('links rows with a note, without a note and with an unknown account, keeping amount and date', () => {
    renderApp(
      <RecentMovements
        locale="es"
        timeZone="UTC"
        items={[
          ROW,
          { ...ROW, id: 'm2', note: null },
          { ...ROW, id: 'm3', accountName: undefined, currency: undefined },
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      const scope = within(row);
      expect(scope.getByRole('link').getAttribute('href')).toBe(
        `/es/movements?focus=m${index === 0 ? '1' : String(index + 1)}`,
      );
      expect(row.querySelector('[data-slot="amount"]')).not.toBeNull();
      expect(row.querySelector('time')?.textContent).toBe('2 oct 2026');
    });
  });

  it('keeps the empty state unchanged', () => {
    renderApp(<RecentMovements locale="es" timeZone="UTC" items={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: es.home.recent.empty.action })).toBeDefined();
  });

  it('shows the error state and no row link when the home requests fail', async () => {
    stubApi({});
    renderApp(<HomeContainer />);
    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
    expect(
      screen.queryByRole('link', { name: new RegExp(es.home.recent.openInMovements) }),
    ).toBeNull();
  });

  it('has the new key in both catalogs, not empty', () => {
    expect(es.home.recent.openInMovements.trim()).not.toBe('');
    expect(en.home.recent.openInMovements.trim()).not.toBe('');
  });
});
