// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { SecondFactorContainer } from '../src/features/auth/containers/second-factor-container';
import { SignInContainer } from '../src/features/auth/containers/sign-in-container';
import { CategoriesCard } from '../src/features/dashboard/components/categories-card';
import { NetWorthCard } from '../src/features/dashboard/components/net-worth-card';
import { BottomNav } from '../src/features/shell/components/bottom-nav';
import { MoreMenu } from '../src/features/shell/components/more-menu';
import { TopNav } from '../src/features/shell/components/top-nav';
import { AuthenticatedShellContainer } from '../src/features/shell/containers/authenticated-shell-container';
import {
  backButtonVisibility,
  isActiveInBottomNav,
  MORE_ITEM,
} from '../src/features/shell/nav-items';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

function slot(container: HTMLElement, name: 'top-nav' | 'bottom-nav'): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!found) throw new Error(`no ${name} rendered`);
  return found;
}

const REPORT_ROUTES = ['/reports/categories', '/reports/income-expenses', '/reports/net-worth'];

describe('Reports navigation entry (AC-04, AC-05)', () => {
  it('the side menu lists Reports in the plan ahead block, below the 1024 px bottom bar (AC-04)', () => {
    const { container } = renderApp(
      <ThemeProvider>
        <TopNav currentPath={undefined} signingOut={false} onSignOut={vi.fn()} />
      </ThemeProvider>,
      { locale: 'en' },
    );

    const nav = within(slot(container, 'top-nav'));
    expect(nav.getByRole('link', { name: en.app.nav.reports }).getAttribute('href')).toBe(
      '/en/reports',
    );
  });

  it('the More page lists Reports (AC-05)', () => {
    renderApp(
      <ThemeProvider>
        <MoreMenu signingOut={false} signOutError={undefined} onSignOut={vi.fn()} />
      </ThemeProvider>,
      { locale: 'es' },
    );

    expect(
      within(screen.getByRole('main'))
        .getByRole('link', { name: es.app.nav.reports })
        .getAttribute('href'),
    ).toBe('/es/reports');
  });

  it.each(REPORT_ROUTES)('More is current on %s (AC-05)', (path) => {
    expect(isActiveInBottomNav(MORE_ITEM, path)).toBe(true);
  });

  it('the bottom bar still has four destinations around the add action', () => {
    const { container } = renderApp(<BottomNav />, { locale: 'en' });

    const links = within(slot(container, 'bottom-nav'))
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? link.textContent);
    expect(links).toEqual([
      en.app.nav.home,
      en.app.nav.movements,
      en.app.nav.addMovement,
      en.app.nav.groups,
      en.app.nav.more,
    ]);
  });

  it.each(['/reports', ...REPORT_ROUTES])('has no back button in the desk layout on %s', (path) => {
    expect(backButtonVisibility(path).desk).toBe(false);
  });

  it('keeps the back button for other pages below the menu roots in the desk layout', () => {
    expect(backButtonVisibility('/accounts/new').desk).toBe(true);
  });
});

describe('Dashboard links to reports (AC-06, AC-07)', () => {
  it('the categories card links to the categories report', () => {
    renderApp(
      <CategoriesCard
        locale="en"
        currency="ARS"
        categories={[{ key: 'food', label: 'Food', amount: 100n, share: 100 }]}
      />,
      { locale: 'en' },
    );

    const link = screen.getByRole('link', { name: en.dashboard.categories.viewReport });
    expect(link.getAttribute('href')).toBe('/en/reports/categories');
  });

  it('the net worth card links to the net worth report', () => {
    renderApp(
      <NetWorthCard
        locale="es"
        currency="ARS"
        netWorth={{ total: 100n, reason: null, ars: 100n, usd: 0n, holdingsWithoutPrice: 0 }}
        series={{ kind: 'ready', currency: 'ARS', points: [] }}
      />,
      { locale: 'es' },
    );

    const link = screen.getByRole('link', { name: es.dashboard.netWorth.viewReport });
    expect(link.getAttribute('href')).toBe('/es/reports/net-worth');
  });
});

describe('Return after sign-in (AC-03)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  it('a shell with no session redirects to sign-in carrying the report route', async () => {
    stubApi({
      'GET /auth/session': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(
      <AuthenticatedShellContainer>
        <p>private content</p>
      </AuthenticatedShellContainer>,
      { pathname: '/es/reports/net-worth' },
    );

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in?next=%2Freports%2Fnet-worth');
    });
  });
});

function signedIn(emailVerified: boolean) {
  return {
    status: 200,
    body: {
      status: 'signed_in',
      user: { id: 'u1', email: 'ana@example.com', emailVerified, language: 'es' },
    },
  };
}

async function signInWith(search: string, verified = true) {
  window.history.replaceState(null, '', `/es/sign-in${search}`);
  stubApi({ 'POST /auth/sign-in': signedIn(verified) });
  const rendered = renderApp(<SignInContainer />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(es.auth.fields.email), 'ana@example.com');
  await user.type(screen.getByLabelText(es.auth.fields.password), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: es.auth.signIn.submit }));
  return rendered;
}

describe('SignInContainer return path (AC-03)', () => {
  it('returns to the report route in next', async () => {
    const { router } = await signInWith('?next=%2Freports%2Fnet-worth');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/reports/net-worth');
    });
  });

  it.each(['https%3A%2F%2Fevil.example', '%2F%2Fevil.example', '%2Fmovements'])(
    'ignores next=%s and goes home with no error',
    async (value) => {
      const { router } = await signInWith(`?next=${value}`);
      await waitFor(() => {
        expect(router.replace).toHaveBeenCalledWith('/es');
      });
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('goes home when next is missing', async () => {
    const { router } = await signInWith('');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es');
    });
  });

  it('the unverified-email destination wins over the return path', async () => {
    const { router } = await signInWith('?next=%2Freports%2Fnet-worth', false);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
  });

  it('passes next on to the second step', async () => {
    window.history.replaceState(null, '', '/es/sign-in?next=%2Freports%2Fnet-worth');
    stubApi({
      'POST /auth/sign-in': { status: 200, body: { status: 'second_factor_required' } },
    });
    const { router } = renderApp(<SignInContainer />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(es.auth.fields.email), 'ana@example.com');
    await user.type(screen.getByLabelText(es.auth.fields.password), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: es.auth.signIn.submit }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        '/es/sign-in/second-factor?next=%2Freports%2Fnet-worth',
      );
    });
  });
});

async function verifyWith(search: string, verified = true) {
  window.history.replaceState(null, '', `/es/sign-in/second-factor${search}`);
  stubApi({ 'POST /auth/2fa/verify': signedIn(verified) });
  const rendered = renderApp(<SecondFactorContainer />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(es.auth.secondFactor.code), '123456');
  await user.click(screen.getByRole('button', { name: es.auth.secondFactor.submit }));
  return rendered;
}

describe('SecondFactorContainer return path (AC-03)', () => {
  it('returns to the report route on success', async () => {
    const { router } = await verifyWith('?next=%2Freports%2Fcategories');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/reports/categories');
    });
  });

  it('an unverified email goes to check-your-email', async () => {
    const { router } = await verifyWith('?next=%2Freports%2Fcategories', false);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
  });

  it('ignores an invalid next and goes home', async () => {
    const { router } = await verifyWith('?next=%2F%2Fevil.example');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es');
    });
  });
});
