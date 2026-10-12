// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuickActions } from '../src/features/home/components/quick-actions';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

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
