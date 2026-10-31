// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import es from '../messages/es.json';
import { TopBar } from '../src/features/shell/components/top-bar';
import { backButtonVisibility, parentRoute } from '../src/features/shell/nav-items';
import { renderApp } from './support/render-app';

describe('backButtonVisibility', () => {
  it('shows nothing without a path', () => {
    expect(backButtonVisibility(undefined)).toEqual({ compact: false, desk: false });
  });

  it('keeps the phone free of a back button on the four pages of the bottom bar', () => {
    for (const path of ['/', '/movements', '/groups', '/more']) {
      expect(backButtonVisibility(path).compact, path).toBe(false);
    }
  });

  it('asks for one on a phone everywhere else, and on a desk only off the side menu', () => {
    expect(backButtonVisibility('/accounts')).toEqual({ compact: true, desk: false });
    expect(backButtonVisibility('/cards')).toEqual({ compact: true, desk: false });
    expect(backButtonVisibility('/movements/new')).toEqual({ compact: true, desk: true });
    expect(backButtonVisibility('/cards/abc')).toEqual({ compact: true, desk: true });
  });
});

describe('parentRoute', () => {
  it('names no parent on the bottom bar pages', () => {
    for (const path of ['/', '/movements', '/groups', '/more']) {
      expect(parentRoute(path), path).toBeUndefined();
    }
    expect(parentRoute(undefined)).toBeUndefined();
  });

  it('sends the pages More lists back to More, and their children to them', () => {
    expect(parentRoute('/accounts')).toEqual({ href: '/more', labelKey: 'more' });
    expect(parentRoute('/reports/categories')).toEqual({ href: '/more', labelKey: 'more' });
    expect(parentRoute('/settings/security')).toEqual({ href: '/more', labelKey: 'more' });
    expect(parentRoute('/accounts/new')).toEqual({ href: '/accounts', labelKey: 'accounts' });
    expect(parentRoute('/recurring/r1')).toEqual({ href: '/recurring', labelKey: 'recurring' });
    expect(parentRoute('/movements/new')).toEqual({ href: '/movements', labelKey: 'movements' });
  });

  it('goes up one detail page at a time', () => {
    expect(parentRoute('/cards/c1')).toEqual({ href: '/cards', labelKey: 'cards' });
    expect(parentRoute('/cards/c1/payments/new')).toEqual({ href: '/cards/c1', labelKey: 'card' });
    expect(parentRoute('/budgets/b1/edit')).toEqual({ href: '/budgets/b1', labelKey: 'budget' });
    expect(parentRoute('/goals/new')).toEqual({ href: '/goals', labelKey: 'goals' });
    expect(parentRoute('/groups/new')).toEqual({ href: '/groups', labelKey: 'groups' });
    expect(parentRoute('/groups/g1')).toEqual({ href: '/groups', labelKey: 'groups' });
    expect(parentRoute('/groups/g1/settlements')).toEqual({
      href: '/groups/g1',
      labelKey: 'group',
    });
    expect(parentRoute('/groups/g1/expenses/e1/edit')).toEqual({
      href: '/groups/g1',
      labelKey: 'group',
    });
    expect(parentRoute('/groups/g1/settlements/s1/edit')).toEqual({
      href: '/groups/g1/settlements',
      labelKey: 'settlements',
    });
  });
});

describe('TopBar back link', () => {
  it('has no back link on the home', () => {
    renderApp(<TopBar online pending={0} currentPath="/" />);

    expect(screen.queryByRole('link', { name: /^Atrás:/ })).toBeNull();
  });

  it('carries the brand on the home only, where no page sits above', () => {
    const { container, unmount } = renderApp(<TopBar online pending={0} currentPath="/" />);
    expect(container.querySelector('[data-slot="top-bar-brand"]')?.textContent).toBe('Pesly');
    unmount();

    const other = renderApp(<TopBar online pending={0} currentPath="/movements" />);
    expect(other.container.querySelector('[data-slot="top-bar-brand"]')).toBeNull();
  });

  it('names the page above and links to it, not to the history', () => {
    renderApp(<TopBar online pending={0} currentPath="/groups/g1/settlements" />);

    const link = screen.getByRole('link', { name: 'Atrás: Grupo' });
    expect(link.getAttribute('href')).toBe('/es/groups/g1');
    expect(link.textContent).toBe(es.app.topBar.parents.group);
  });
});
