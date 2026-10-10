// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import es from '../messages/es.json';
import { TopBar } from '../src/features/shell/components/top-bar';
import { backButtonVisibility } from '../src/features/shell/nav-items';
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

describe('TopBar back button', () => {
  it('has no back button on the home', () => {
    renderApp(<TopBar online pending={0} currentPath="/" />);

    expect(screen.queryByRole('button', { name: es.app.topBar.back })).toBeNull();
  });

  it('goes to the home when the page was opened directly and has nothing behind it', async () => {
    const { router } = renderApp(<TopBar online pending={0} currentPath="/accounts" />);

    await userEvent.setup().click(screen.getByRole('button', { name: es.app.topBar.back }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/es');
  });

  it('goes back through the router when the page has history', async () => {
    const { router } = renderApp(<TopBar online pending={0} currentPath="/accounts" />);
    window.history.pushState({}, '', '/a');
    window.history.pushState({}, '', '/b');

    await userEvent.setup().click(screen.getByRole('button', { name: es.app.topBar.back }));

    expect(router.back).toHaveBeenCalledOnce();
  });
});
