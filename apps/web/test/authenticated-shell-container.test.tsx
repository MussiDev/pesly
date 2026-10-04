// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { AuthenticatedShellContainer } from '../src/features/shell/containers/authenticated-shell-container';
import { readSessionPointer, writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

function session(emailVerified: boolean) {
  return {
    status: 200,
    body: {
      user: {
        id: 'u1',
        email: 'ana@example.com',
        emailVerified,
        language: 'es',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    },
  };
}

const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };

function renderShell() {
  return renderApp(
    <ThemeProvider>
      <AuthenticatedShellContainer>
        <p>private content</p>
      </AuthenticatedShellContainer>
    </ThemeProvider>,
  );
}

describe('AuthenticatedShellContainer', () => {
  it('shows the app only after the API confirms a verified session', async () => {
    const { calls } = stubApi({ 'GET /auth/session': session(true) });
    renderShell();

    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="side-nav"]')).not.toBeNull();
    expect(screen.queryByText('private content')).toBeNull();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.getByRole('button', { name: es.auth.signOut.label })).toBeDefined();
    expect(calls).toEqual([{ method: 'GET', path: '/auth/session', body: undefined }]);
  });

  it('refreshes an expired access token before deciding', async () => {
    const { calls } = stubApi({
      'GET /auth/session': [UNAUTHENTICATED, UNAUTHENTICATED, session(true)],
      'POST /auth/refresh': { status: 200, body: { status: 'refreshed' } },
    });
    const { router } = renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /auth/session',
      'GET /auth/session',
      'POST /auth/refresh',
      'GET /auth/session',
    ]);
  });

  it('sends a visitor without a session to sign-in', async () => {
    stubApi({ 'GET /auth/session': UNAUTHENTICATED, 'POST /auth/refresh': UNAUTHENTICATED });
    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('sends an unverified account to "check your email" (AC-04)', async () => {
    stubApi({ 'GET /auth/session': session(false) });
    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('offers a retry instead of signing out when the API is unreachable', async () => {
    stubApi({ 'GET /auth/session': ['network-error', session(true)] });
    const { router } = renderShell();

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText('private content')).toBeDefined();
  });

  it('signs out and goes to sign-in', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(true),
      'POST /auth/sign-out': { status: 204 },
    });
    const { router } = renderShell();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.auth.signOut.label }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/auth/sign-out', body: {} });
  });

  it('keeps the user in the app and shows why signing out failed', async () => {
    stubApi({ 'GET /auth/session': session(true), 'POST /auth/sign-out': 'network-error' });
    const { router } = renderShell();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.auth.signOut.label }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByText('private content')).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.signOut.label }).hasAttribute('disabled'),
    ).toBe(false);
  });

  // Both navigations are in the DOM (CSS shows one), so a destination appears in each of them.
  function currents(name: string): (string | null)[] {
    return screen.getAllByRole('link', { name }).map((link) => link.getAttribute('aria-current'));
  }

  it('marks the security link as the current page on the security settings', async () => {
    stubApi({ 'GET /auth/session': session(true) });
    renderApp(
      <ThemeProvider>
        <AuthenticatedShellContainer>
          <p>private content</p>
        </AuthenticatedShellContainer>
      </ThemeProvider>,
      { pathname: '/es/settings/security' },
    );

    const link = await screen.findByRole('link', { name: es.app.nav.security });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(currents(es.app.nav.home)).toEqual([null, null]);
    expect(currents(es.app.nav.investments)).toEqual([null]);
  });

  it('marks the investments link as the current page on /investments', async () => {
    stubApi({ 'GET /auth/session': session(true) });
    renderApp(
      <ThemeProvider>
        <AuthenticatedShellContainer>
          <p>private content</p>
        </AuthenticatedShellContainer>
      </ThemeProvider>,
      { pathname: '/es/investments' },
    );

    await screen.findByText('private content');
    expect(currents(es.app.nav.investments)).toEqual(['page']);
    for (const link of screen.getAllByRole('link', { name: es.app.nav.investments })) {
      expect(link.getAttribute('href')).toBe('/es/investments');
    }
    for (const name of [es.app.nav.home, es.app.nav.security, es.app.nav.profile]) {
      expect(currents(name).every((value) => value === null)).toBe(true);
    }
  });

  it('links to the movements list and marks it as the current page there (AC-14)', async () => {
    stubApi({ 'GET /auth/session': session(true) });
    renderApp(
      <ThemeProvider>
        <AuthenticatedShellContainer>
          <p>private content</p>
        </AuthenticatedShellContainer>
      </ThemeProvider>,
      { pathname: '/es/movements' },
    );

    await screen.findByText('private content');
    expect(currents(es.app.nav.movements)).toEqual(['page', 'page']);
    for (const link of screen.getAllByRole('link', { name: es.app.nav.movements })) {
      expect(link.getAttribute('href')).toBe('/es/movements');
    }
    expect(currents(es.app.nav.home)).toEqual([null, null]);
  });

  it('links to the categories and marks them as the current page there', async () => {
    stubApi({ 'GET /auth/session': session(true) });
    renderApp(
      <ThemeProvider>
        <AuthenticatedShellContainer>
          <p>private content</p>
        </AuthenticatedShellContainer>
      </ThemeProvider>,
      { pathname: '/es/categories' },
    );

    const link = await screen.findByRole('link', { name: es.app.nav.categories });
    expect(link.getAttribute('href')).toBe('/es/categories');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('link', { name: es.app.nav.security }).getAttribute('aria-current'),
    ).toBeNull();
  });
});

describe('AuthenticatedShellContainer without connectivity (DISC-001-04a)', () => {
  const ANA = '11111111-1111-4111-8111-111111111111';

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  beforeEach(() => {
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it('renders ready from the pointer and makes no request while offline (FR-03)', async () => {
    writeSessionPointer({ userId: ANA, emailVerified: true });
    setOnline(false);
    const { fetch } = stubApi({});

    renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the failed state with a retry when offline and nobody signed in on this device (FR-03)', async () => {
    setOnline(false);
    stubApi({});

    renderShell();

    expect(await screen.findByText(es.errors.offlineNoCopy)).toBeDefined();
    expect(screen.queryByText('private content')).toBeNull();
    expect(screen.getByRole('button', { name: es.app.retry })).toBeDefined();
  });

  it('does not trust a pointer of an unverified user while offline (FR-03)', async () => {
    writeSessionPointer({ userId: ANA, emailVerified: false });
    setOnline(false);
    stubApi({});

    renderShell();

    expect(await screen.findByText(es.errors.offlineNoCopy)).toBeDefined();
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('opens from the pointer when the session request fails with a network error (FR-03)', async () => {
    writeSessionPointer({ userId: ANA, emailVerified: true });
    stubApi({ 'GET /auth/session': 'network-error' });

    renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
  });

  it('keeps the failed state on a network error when no pointer exists (FR-03)', async () => {
    stubApi({ 'GET /auth/session': 'network-error' });

    renderShell();

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('writes the pointer only after a successful online session check (FR-03)', async () => {
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();
    await screen.findByText('private content');

    expect(readSessionPointer()).toEqual({ userId: 'u1', emailVerified: true });
  });

  it('writes no pointer and still redirects to sign in on a 401 (FR-03)', async () => {
    stubApi({
      'GET /auth/session': UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });

    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(readSessionPointer()).toBeNull();
  });
});

describe('AuthenticatedShellContainer service worker warm-up (DISC-001-04a)', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  function setServiceWorker(value: unknown): void {
    Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
  }

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'serviceWorker', original);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
    localStorage.clear();
  });

  it('asks the worker to cache the two offline screens once, after the shell is ready (FR-04)', async () => {
    const postMessage = vi.fn();
    setServiceWorker({ ready: Promise.resolve({ active: { postMessage } }) });
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();
    await screen.findByText('private content');

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'PESLY_CACHE_URLS',
      urls: ['/es/movements', '/es/movements/new'],
    });
  });

  it('asks nothing of the worker while the session is not confirmed (FR-04)', async () => {
    const postMessage = vi.fn();
    setServiceWorker({ ready: Promise.resolve({ active: { postMessage } }) });
    stubApi({
      'GET /auth/session': UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });

    renderShell();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(postMessage).not.toHaveBeenCalled();
  });
});
