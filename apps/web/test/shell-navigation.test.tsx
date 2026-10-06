// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MorePage from '../src/app/[locale]/(app)/more/page';
import { ThemeProvider } from '../src/components/theme-provider';
import { AuthenticatedShell } from '../src/features/shell/components/authenticated-shell';
import { BottomNav } from '../src/features/shell/components/bottom-nav';
import { MoreMenu } from '../src/features/shell/components/more-menu';
import { SideNav } from '../src/features/shell/components/side-nav';
import { SignOutAlert } from '../src/features/shell/components/sign-out-alert';
import { SignOutButton } from '../src/features/shell/components/sign-out-button';
import { MoreContainer } from '../src/features/shell/containers/more-container';
import { isActivePath } from '../src/features/shell/nav-items';
import { useSignOut } from '../src/features/shell/use-sign-out';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

type Slot = 'bottom-nav' | 'side-nav';

function navOf(container: HTMLElement, slot: Slot): HTMLElement {
  const nav = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!nav) throw new Error(`no ${slot} rendered`);
  return nav;
}

describe('SignOutButton', () => {
  it('signs out on click', async () => {
    const onSignOut = vi.fn();
    renderApp(<SignOutButton pending={false} onSignOut={onSignOut} />);

    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signOut.label }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('is disabled and says so while signing out', () => {
    renderApp(<SignOutButton pending onSignOut={vi.fn()} />, { locale: 'en' });

    const button = screen.getByRole('button', { name: en.auth.signOut.pending });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: en.auth.signOut.label })).toBeNull();
  });
});

describe('BottomNav (AC-12)', () => {
  it('carries the md:hidden class contract', () => {
    const { container } = renderApp(<BottomNav />);

    const nav = navOf(container, 'bottom-nav');
    expect(nav.tagName).toBe('NAV');
    expect(nav.classList.contains('md:hidden')).toBe(true);
    expect(nav.classList.contains('hidden')).toBe(false);
  });

  it('has four destinations around the add action, in this order, and no Investments', () => {
    const { container } = renderApp(<BottomNav />, { locale: 'en' });

    const names = within(navOf(container, 'bottom-nav'))
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? link.textContent);
    expect(names).toEqual([
      en.app.nav.home,
      en.app.nav.accounts,
      en.app.nav.addMovement,
      en.app.nav.movements,
      en.app.nav.more,
    ]);
  });

  it('lists the primary destinations and More, in the current locale', () => {
    const { container } = renderApp(<BottomNav />, { locale: 'en' });

    const nav = within(navOf(container, 'bottom-nav'));
    expect(nav.getByRole('link', { name: en.app.nav.home }).getAttribute('href')).toBe('/en');
    expect(nav.getByRole('link', { name: en.app.nav.accounts }).getAttribute('href')).toBe(
      '/en/accounts',
    );
    expect(nav.getByRole('link', { name: en.app.nav.movements }).getAttribute('href')).toBe(
      '/en/movements',
    );
    expect(nav.queryByRole('link', { name: en.app.nav.investments })).toBeNull();
    expect(nav.getByRole('link', { name: en.app.nav.more }).getAttribute('href')).toBe('/en/more');
  });

  it('keeps a persistent add-movement action with its own accessible name', () => {
    const { container } = renderApp(<BottomNav />);

    const nav = within(navOf(container, 'bottom-nav'));
    const add = nav.getByRole('link', { name: es.app.nav.addMovement });
    expect(add.getAttribute('href')).toBe('/es/movements/new');
    const others = nav
      .getAllByRole('link')
      .filter((link) => link !== add)
      .map((link) => link.textContent);
    expect(others).not.toContain(es.app.nav.addMovement);
    expect(es.app.nav.addMovement).not.toBe(es.movements.list.newMovement);
  });

  it('respects the device safe area through the pb-safe utility', () => {
    const { container } = renderApp(<BottomNav />);

    expect(navOf(container, 'bottom-nav').classList.contains('pb-safe')).toBe(true);
  });

  it('sits in the page flow (sticky), so no content padding depends on its height', () => {
    const { container } = renderApp(<BottomNav />);

    const nav = navOf(container, 'bottom-nav');
    expect(nav.classList.contains('sticky')).toBe(true);
    expect(nav.classList.contains('bottom-0')).toBe(true);
    expect(nav.classList.contains('fixed')).toBe(false);
  });

  it('truncates every label instead of wrapping or overflowing at 360px', () => {
    const { container } = renderApp(<BottomNav />, { locale: 'en' });

    const links = within(navOf(container, 'bottom-nav')).getAllByRole('link');
    const labelled = links.filter((link) => link.getAttribute('aria-label') === null);
    expect(labelled).toHaveLength(4);
    // Four equal slots and the add button must leave "Movimientos" room at 360px: no side padding.
    expect(navOf(container, 'bottom-nav').querySelector('ul')?.className).not.toMatch(
      /\b(px|gap)-/,
    );
    for (const link of labelled) {
      expect(link.className).not.toMatch(/\bpx-/);
      const label = link.querySelector('span');
      expect(label?.classList.contains('truncate'), link.textContent).toBe(true);
      expect(label?.classList.contains('min-w-0')).toBe(true);
      expect(link.classList.contains('min-w-0')).toBe(true);
      expect(link.classList.contains('min-h-11')).toBe(true);
    }
  });
});

describe('SideNav (AC-13)', () => {
  function renderSide(options?: { locale?: 'es' | 'en'; currentPath?: string }) {
    const onSignOut = vi.fn();
    const result = renderApp(
      <ThemeProvider>
        <SideNav currentPath={options?.currentPath} signingOut={false} onSignOut={onSignOut} />
      </ThemeProvider>,
      { locale: options?.locale },
    );
    return { ...result, onSignOut };
  }

  it('carries the hidden md:flex class contract', () => {
    const { container } = renderSide();

    const nav = navOf(container, 'side-nav');
    expect(nav.classList.contains('hidden')).toBe(true);
    expect(nav.classList.contains('md:flex')).toBe(true);
    expect(nav.classList.contains('md:hidden')).toBe(false);
  });

  it('links to the destinations plus categories, profile and security directly', () => {
    const { container } = renderSide({ locale: 'en' });

    const nav = within(navOf(container, 'side-nav'));
    expect(nav.getByRole('link', { name: en.app.nav.categories }).getAttribute('href')).toBe(
      '/en/categories',
    );
    expect(nav.getByRole('link', { name: en.app.nav.cards }).getAttribute('href')).toBe(
      '/en/cards',
    );
    expect(nav.getByRole('link', { name: en.app.nav.profile }).getAttribute('href')).toBe(
      '/en/settings/profile',
    );
    expect(nav.getByRole('link', { name: en.app.nav.security }).getAttribute('href')).toBe(
      '/en/settings/security',
    );
    for (const key of ['home', 'accounts', 'movements', 'investments'] as const) {
      expect(nav.getByRole('link', { name: en.app.nav[key] })).toBeDefined();
    }
    expect(nav.getByRole('link', { name: en.app.nav.addMovement }).getAttribute('href')).toBe(
      '/en/movements/new',
    );
  });

  it('keeps Investments as a direct link, as the bottom bar has no room for it', () => {
    const { container } = renderSide({ locale: 'en' });

    const link = within(navOf(container, 'side-nav')).getByRole('link', {
      name: en.app.nav.investments,
    });
    expect(link.getAttribute('href')).toBe('/en/investments');
  });

  it('fits the theme toggle in the sidebar with the compact variant', () => {
    const { container } = renderSide();

    const group = navOf(container, 'side-nav').querySelector('fieldset > div');
    expect(group?.classList.contains('w-full')).toBe(true);
    expect(group?.classList.contains('inline-flex')).toBe(false);
  });

  it('has the theme toggle and a sign-out button that signs out', async () => {
    const { container, onSignOut } = renderSide();

    const nav = within(navOf(container, 'side-nav'));
    expect(nav.getByRole('radio', { name: es.theme.dark })).toBeDefined();
    await userEvent.setup().click(nav.getByRole('button', { name: es.auth.signOut.label }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe('current destination (AC-14)', () => {
  function renderShellAt(currentPath: string) {
    return renderApp(
      <ThemeProvider>
        <AuthenticatedShell
          state={{ kind: 'ready' }}
          currentPath={currentPath}
          signingOut={false}
          signOutError={undefined}
          onRetry={vi.fn()}
          onSignOut={vi.fn()}
        >
          <p>private content</p>
        </AuthenticatedShell>
      </ThemeProvider>,
    );
  }

  // [path, link marked in the bottom bar, link marked in the side navigation]
  it.each([
    ['/', '/es', '/es'],
    ['/accounts', '/es/accounts', '/es/accounts'],
    ['/accounts/new', '/es/accounts', '/es/accounts'],
    ['/movements', '/es/movements', '/es/movements'],
    ['/investments', '/es/more', '/es/investments'],
    ['/investments/abc', '/es/more', '/es/investments'],
    ['/more', '/es/more', undefined],
    ['/categories', '/es/more', '/es/categories'],
    ['/settings/profile', '/es/more', '/es/settings/profile'],
    ['/settings/security', '/es/more', '/es/settings/security'],
  ])('on %s the bottom bar marks %s and the side nav %s, one link each', (path, bottom, side) => {
    const { container } = renderShellAt(path);

    const marked = (slot: Slot) =>
      within(navOf(container, slot))
        .queryAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.getAttribute('href'));
    expect(marked('bottom-nav')).toEqual([bottom]);
    expect(marked('side-nav')).toEqual(side ? [side] : []);
  });

  it('marks the movements destination, never the add action, on the new-movement page', () => {
    renderShellAt('/movements/new');

    for (const add of screen.getAllByRole('link', { name: es.app.nav.addMovement })) {
      expect(add.getAttribute('aria-current')).toBeNull();
    }
    for (const link of screen.getAllByRole('link', { name: es.app.nav.movements })) {
      expect(link.getAttribute('aria-current')).toBe('page');
    }
  });

  it('marks nothing outside Next.js, where there is no pathname', () => {
    renderApp(
      <ThemeProvider>
        <AuthenticatedShell
          state={{ kind: 'ready' }}
          signingOut={false}
          signOutError={undefined}
          onRetry={vi.fn()}
          onSignOut={vi.fn()}
        >
          <p />
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('aria-current')).toBeNull();
    }
  });

  it('does not take a path that only shares a prefix for the destination', () => {
    expect(isActivePath('/accounts', '/accounts-archive')).toBe(false);
    expect(isActivePath('/accounts', '/accounts/new')).toBe(true);
    expect(isActivePath('/', '/accounts')).toBe(false);
    expect(isActivePath('/accounts', undefined)).toBe(false);
  });
});

describe('MoreMenu (FR-07)', () => {
  function renderMore(props?: { signingOut?: boolean; signOutError?: 'network' }) {
    const onSignOut = vi.fn();
    const result = renderApp(
      <ThemeProvider>
        <MoreMenu
          signingOut={props?.signingOut ?? false}
          signOutError={props?.signOutError}
          onSignOut={onSignOut}
        />
      </ThemeProvider>,
      { locale: 'en' },
    );
    return { ...result, onSignOut };
  }

  it('lists investments first, then categories, profile and security', () => {
    renderMore();

    const main = within(screen.getByRole('main'));
    expect(main.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/en/investments',
      '/en/categories',
      '/en/cards',
      '/en/settings/profile',
      '/en/settings/security',
    ]);
  });

  it('lists categories, profile, security, the theme toggle and sign out', async () => {
    const { onSignOut } = renderMore();

    expect(screen.getByRole('link', { name: en.app.nav.investments })).toBeDefined();
    expect(screen.getByRole('heading', { name: en.app.more.title })).toBeDefined();
    expect(screen.getByRole('link', { name: en.app.nav.categories }).getAttribute('href')).toBe(
      '/en/categories',
    );
    expect(screen.getByRole('link', { name: en.app.nav.profile }).getAttribute('href')).toBe(
      '/en/settings/profile',
    );
    expect(screen.getByRole('link', { name: en.app.nav.security }).getAttribute('href')).toBe(
      '/en/settings/security',
    );
    expect(screen.getByRole('group', { name: en.theme.label })).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: en.auth.signOut.label }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('disables sign out while it is in progress', () => {
    renderMore({ signingOut: true });

    expect(
      screen.getByRole('button', { name: en.auth.signOut.pending }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows why signing out failed', () => {
    renderMore({ signOutError: 'network' });

    expect(screen.getByRole('alert').textContent).toBe(en.errors.network);
  });
});

describe('AuthenticatedShell session states', () => {
  const idle = { signingOut: false, signOutError: undefined, onSignOut: vi.fn() };

  it('draws the frame and a skeleton while checking, and mounts no child', () => {
    const { container } = renderApp(
      <ThemeProvider>
        <AuthenticatedShell state={{ kind: 'loading' }} onRetry={vi.fn()} {...idle}>
          <p>private content</p>
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    expect(navOf(container, 'bottom-nav')).toBeDefined();
    expect(navOf(container, 'side-nav')).toBeDefined();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('draws the same landmarks and skip link while checking as when ready', () => {
    const landmarks = (container: HTMLElement) => ({
      navs: Array.from(container.querySelectorAll('nav')).map((nav) =>
        nav.getAttribute('aria-label'),
      ),
      skip: container.querySelector('a[href="#main-content"]')?.textContent,
      target: container.querySelector('#main-content') !== null,
    });
    const loading = renderApp(
      <ThemeProvider>
        <AuthenticatedShell state={{ kind: 'loading' }} onRetry={vi.fn()} {...idle}>
          <p />
        </AuthenticatedShell>
      </ThemeProvider>,
    );
    const loadingFrame = landmarks(loading.container);
    loading.unmount();
    const ready = renderApp(
      <ThemeProvider>
        <AuthenticatedShell state={{ kind: 'ready' }} onRetry={vi.fn()} {...idle}>
          <p />
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    expect(loadingFrame.navs).toEqual([es.app.nav.label, es.app.nav.label]);
    expect(loadingFrame.skip).toBe(es.app.skipToContent);
    expect(loadingFrame.target).toBe(true);
    expect(landmarks(ready.container)).toEqual(loadingFrame);
  });

  it('shows the error state with a working retry when the check fails', async () => {
    const onRetry = vi.fn();
    renderApp(
      <ThemeProvider>
        <AuthenticatedShell
          state={{ kind: 'failed', error: 'retryLater' }}
          onRetry={onRetry}
          {...idle}
        >
          <p>private content</p>
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(es.errors.retryLater)).toBeDefined();
    expect(screen.queryByText('private content')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the app and shows the alert when signing out failed', () => {
    renderApp(
      <ThemeProvider>
        <AuthenticatedShell
          state={{ kind: 'ready' }}
          signingOut={false}
          signOutError="network"
          onRetry={vi.fn()}
          onSignOut={vi.fn()}
        >
          <p>private content</p>
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    expect(screen.getByText('private content')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe(es.errors.network);
  });

  it('keeps the bottom bar out of the content, which carries no height-bound padding', () => {
    const { container } = renderApp(
      <ThemeProvider>
        <AuthenticatedShell state={{ kind: 'ready' }} onRetry={vi.fn()} {...idle}>
          <p>private content</p>
        </AuthenticatedShell>
      </ThemeProvider>,
    );

    const content = container.querySelector('#main-content');
    expect(content?.contains(navOf(container, 'bottom-nav'))).toBe(false);
    expect(Array.from(content?.classList ?? []).some((name) => /^(md:)?pb-\d/.test(name))).toBe(
      false,
    );
  });
});

describe('skip link', () => {
  function renderReady() {
    return renderApp(
      <ThemeProvider>
        <AuthenticatedShell
          state={{ kind: 'ready' }}
          signingOut={false}
          signOutError={undefined}
          onRetry={vi.fn()}
          onSignOut={vi.fn()}
        >
          <main>
            <p>private content</p>
          </main>
        </AuthenticatedShell>
      </ThemeProvider>,
    );
  }

  it('is the first focusable element of the frame and targets the content wrapper', () => {
    const { container } = renderReady();

    const firstFocusable = container.querySelector('a[href], button, input, [tabindex]');
    expect(firstFocusable?.textContent).toBe(es.app.skipToContent);
    expect(firstFocusable?.getAttribute('href')).toBe('#main-content');
    const target = container.querySelector('#main-content');
    expect(target?.getAttribute('tabindex')).toBe('-1');
    expect(target?.contains(screen.getByText('private content'))).toBe(true);
  });

  it('is visually hidden until it takes focus', () => {
    const { container } = renderReady();

    const classes = container.querySelector('a[href="#main-content"]')?.classList;
    expect(classes?.contains('sr-only')).toBe(true);
    expect(classes?.contains('focus:not-sr-only')).toBe(true);
  });

  it('adds no second main landmark: the pages supply their own', () => {
    const { container } = renderReady();

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('#main-content')?.tagName).not.toBe('MAIN');
  });
});

describe('SignOutAlert', () => {
  it('shows the error in the current language as an alert', () => {
    renderApp(<SignOutAlert error="network" />, { locale: 'en' });

    expect(screen.getByRole('alert').textContent).toBe(en.errors.network);
  });

  it('renders nothing without an error', () => {
    const { container } = renderApp(<SignOutAlert error={undefined} />);

    expect(container.textContent).toBe('');
  });
});

describe('useSignOut', () => {
  function Probe() {
    const { signingOut, signOutError, signOut } = useSignOut();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          go
        </button>
        <p data-testid="pending">{String(signingOut)}</p>
        <p data-testid="error">{signOutError ?? ''}</p>
      </>
    );
  }

  it('goes to sign-in after signing out', async () => {
    stubApi({ 'POST /auth/sign-out': { status: 204 } });
    const { router } = renderApp(<Probe />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'go' }));

    await vi.waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.getByTestId('pending').textContent).toBe('true');
  });

  it('stays in place and exposes the error key when signing out fails', async () => {
    stubApi({ 'POST /auth/sign-out': 'network-error' });
    const { router } = renderApp(<Probe />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'go' }));

    await vi.waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('network');
    });
    expect(screen.getByTestId('pending').textContent).toBe('false');
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('MoreContainer and the /more page', () => {
  it('renders the more menu from the page', () => {
    renderApp(
      <ThemeProvider>
        <MorePage />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: es.app.more.title })).toBeDefined();
    expect(screen.getByRole('button', { name: es.auth.signOut.label })).toBeDefined();
  });

  it('signs out and goes to sign-in', async () => {
    const { calls } = stubApi({ 'POST /auth/sign-out': { status: 204 } });
    const { router } = renderApp(
      <ThemeProvider>
        <MoreContainer />
      </ThemeProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signOut.label }));

    await vi.waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls).toEqual([{ method: 'POST', path: '/auth/sign-out', body: {} }]);
  });

  it('keeps the user in place and shows the alert when signing out fails', async () => {
    stubApi({ 'POST /auth/sign-out': 'network-error' });
    const { router } = renderApp(
      <ThemeProvider>
        <MoreContainer />
      </ThemeProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signOut.label }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.signOut.label }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
