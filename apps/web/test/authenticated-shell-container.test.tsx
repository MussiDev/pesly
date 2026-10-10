// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { AuthenticatedShellContainer } from '../src/features/shell/containers/authenticated-shell-container';
import {
  enqueueMovement,
  loadQueue,
  markRejected,
  queueDelete,
  queueEdit,
  type QueuedRequest,
} from '../src/lib/local-store/queue';
import {
  readSessionPointer,
  SESSION_POINTER_KEY,
  writeSessionPointer,
} from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { readWipeMarker, WIPE_MARKER_KEY } from '../src/lib/local-store/wipe-marker';
import { MOVEMENT_QUEUED_EVENT, QUEUE_CHANGED_EVENT } from '../src/lib/sync/sync-events';
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
    expect(document.querySelector('[data-slot="top-nav"]')).not.toBeNull();
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
    for (const name of [es.app.nav.home, es.app.nav.security, es.app.nav.settings]) {
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

  it('asks the worker to cache the offline screens once, after the shell is ready (FR-04)', async () => {
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
      urls: ['/es/movements', '/es/movements/new', '/es/movements/edit'],
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

describe('AuthenticatedShellContainer persistent storage (DISC-001-04a)', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'storage');

  function setStorage(value: unknown): void {
    Object.defineProperty(navigator, 'storage', { value, configurable: true });
  }

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'storage', original);
    else Reflect.deleteProperty(navigator, 'storage');
    localStorage.clear();
  });

  it('requests persistent storage once the shell is ready and shows no warning when granted (AC-05)', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    setStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();
    await screen.findByText('private content');

    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(es.app.storageWarning)).toBeNull();
  });

  it('makes no second request when the storage is already persistent (AC-05)', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(true);
    setStorage({ persisted, persist });
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();
    await screen.findByText('private content');

    await waitFor(() => {
      expect(persisted).toHaveBeenCalled();
    });
    expect(persist).not.toHaveBeenCalled();
    expect(screen.queryByText(es.app.storageWarning)).toBeNull();
  });

  it('shows the warning when the browser denies persistent storage (AC-06)', async () => {
    setStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    });
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();

    expect(await screen.findByText(es.app.storageWarning)).toBeDefined();
    expect(screen.getByText('private content')).toBeDefined();
  });

  it('shows the warning, and throws nothing, when the request fails with an error (AC-06)', async () => {
    setStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();

    expect(await screen.findByText(es.app.storageWarning)).toBeDefined();
  });

  it('shows neither a warning nor an error without the Storage API (FR-05)', async () => {
    setStorage(undefined);
    stubApi({ 'GET /auth/session': session(true) });

    renderShell();
    await screen.findByText('private content');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.queryByText(es.app.storageWarning)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AuthenticatedShellContainer sending the queue (DISC-001-04b)', () => {
  const USER = 'u1';
  const ACCOUNT = '00000000-0000-4000-8000-000000000900';
  const CATEGORY = '00000000-0000-4000-8000-000000000901';
  const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  const created = {
    status: 201,
    body: {
      id: id(1),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      destinationAccountId: null,
      amount: '150050',
      destinationAmount: null,
      occurredAt: '2026-10-02T15:30:00.000Z',
      note: null,
      rate: '14000000',
      rateSource: 'manual',
      rateType: null,
      createdAt: '2026-10-02T15:31:00.000Z',
      tags: [],
    },
  };

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  function request(n: number): QueuedRequest {
    return {
      id: id(n),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '150050',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'manual', value: '14000000' },
    };
  }

  async function queue(...numbers: number[]): Promise<void> {
    const store = await openLocalStore(USER);
    for (const n of numbers) {
      await enqueueMovement(store, request(n), new Date(Date.UTC(2026, 9, 2, 12, 0, n)));
    }
    store.close();
  }

  async function queued(): Promise<number> {
    const store = await openLocalStore(USER);
    const items = await loadQueue(store);
    store.close();
    return items.length;
  }

  const postCount = (calls: { method: string; path: string }[]): number =>
    calls.filter((call) => call.method === 'POST' && call.path === '/movements').length;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it('sends the queue without any user action once the shell is ready (AC-05)', async () => {
    await queue(1, 2);
    const { calls } = stubApi({ 'GET /auth/session': session(true), 'POST /movements': created });

    renderShell();

    await waitFor(async () => {
      expect(await queued()).toBe(0);
    });
    expect(postCount(calls)).toBe(2);
  });

  it('starts a pass when the connection returns, after checking the session (AC-05)', async () => {
    writeSessionPointer({ userId: USER, emailVerified: true });
    setOnline(false);
    const { calls } = stubApi({ 'GET /auth/session': session(true), 'POST /movements': created });
    renderShell();
    expect(await screen.findByText('private content')).toBeDefined();
    await queue(1);
    expect(calls).toEqual([]);

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => {
      expect(await queued()).toBe(0);
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /auth/session',
      'POST /movements',
    ]);
  });

  it('sends a queued edit and a queued deletion with no user action when the connection returns (AC-07)', async () => {
    writeSessionPointer({ userId: USER, emailVerified: true });
    setOnline(false);
    const { calls } = stubApi({
      'GET /auth/session': session(true),
      [`PUT /movements/${id(1)}`]: { status: 200, body: { ...created.body, amount: '999' } },
      [`DELETE /movements/${id(2)}`]: { status: 204 },
    });
    renderShell();
    expect(await screen.findByText('private content')).toBeDefined();
    const store = await openLocalStore(USER);
    await queueEdit(store, created.body as never, {
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '999',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'keep' },
    });
    await queueDelete(store, { ...created.body, id: id(2) } as never);
    store.close();

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => {
      expect(await queued()).toBe(0);
    });
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([
      `DELETE /movements/${id(2)}`,
      'GET /auth/session',
      `PUT /movements/${id(1)}`,
    ]);
  });

  it('starts a pass when a save fell back to the queue while online, and not while offline (FR-04)', async () => {
    const { calls } = stubApi({ 'GET /auth/session': session(true), 'POST /movements': created });
    renderShell();
    await screen.findByText('private content');
    expect(postCount(calls)).toBe(0);

    await queue(1);
    window.dispatchEvent(new Event(MOVEMENT_QUEUED_EVENT));
    await waitFor(async () => {
      expect(await queued()).toBe(0);
    });
    expect(postCount(calls)).toBe(1);

    setOnline(false);
    await queue(2);
    window.dispatchEvent(new Event(MOVEMENT_QUEUED_EVENT));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postCount(calls)).toBe(1);
    expect(await queued()).toBe(1);
  });

  it('sends nothing for an unverified account or a visitor without a session (invalid input)', async () => {
    await queue(1);
    const unverified = stubApi({ 'GET /auth/session': session(false) });
    const first = renderShell();
    await waitFor(() => {
      expect(first.router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
    first.unmount();

    const visitor = stubApi({
      'GET /auth/session': UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });
    const second = renderShell();
    await waitFor(() => {
      expect(second.router.replace).toHaveBeenCalledWith('/es/sign-in');
    });

    expect(postCount(unverified.calls)).toBe(0);
    expect(postCount(visitor.calls)).toBe(0);
    expect(await queued()).toBe(1);
  });

  it('sends nothing without a connection: the pointer alone does not start a pass (FR-04)', async () => {
    await queue(1);
    writeSessionPointer({ userId: USER, emailVerified: true });
    setOnline(false);
    const { fetch } = stubApi({ 'POST /movements': created });

    renderShell();
    await screen.findByText('private content');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetch).not.toHaveBeenCalled();
    expect(await queued()).toBe(1);
  });
});

describe('AuthenticatedShellContainer: the waiting count (DISC-001-04c)', () => {
  const USER = 'u1';
  const ACCOUNT = '00000000-0000-4000-8000-000000000900';
  const CATEGORY = '00000000-0000-4000-8000-000000000901';
  const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  async function queue(...numbers: number[]): Promise<void> {
    const store = await openLocalStore(USER);
    for (const n of numbers) {
      await enqueueMovement(store, {
        id: id(n),
        type: 'expense',
        accountId: ACCOUNT,
        categoryId: CATEGORY,
        amount: '100',
        occurredAt: '2026-10-02T15:30:00.000Z',
        rate: { source: 'manual', value: '14000000' },
      });
    }
    store.close();
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    writeSessionPointer({ userId: USER, emailVerified: true });
    setOnline(false);
  });

  afterEach(() => {
    setOnline(true);
  });

  it('offline, shows the count of changes waiting for the user the device knows (AC-03)', async () => {
    await queue(1, 2, 3);
    stubApi({});

    renderShell();

    expect(await screen.findByText('3 cambios esperando sincronizarse')).toBeDefined();
  });

  it('follows the queue-changed event and disappears at zero (AC-03)', async () => {
    await queue(1, 2, 3);
    stubApi({});
    renderShell();
    await screen.findByText('3 cambios esperando sincronizarse');

    const store = await openLocalStore(USER);
    await store.clear('queue');
    store.close();
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));

    await waitFor(() => {
      expect(screen.queryByText(/esperando sincronizarse/)).toBeNull();
    });
  });

  it('shows the failed changes with a link to the movement list (AC-05)', async () => {
    await queue(1);
    const store = await openLocalStore(USER);
    await markRejected(store, id(1), 'ACCOUNT_ARCHIVED');
    store.close();
    stubApi({});

    renderShell();

    const link = await screen.findByRole('link', { name: '1 cambio no se sincronizó' });
    expect(link.getAttribute('href')).toBe('/es/movements');
  });

  it('shows nothing when the queue cannot be read (invalid input)', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    stubApi({});

    renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(screen.queryByText(/sincroniz/)).toBeNull();
  });
});

describe('session, sign out and local data (DISC-001-04d)', () => {
  const ANA = 'u1';
  const BEA = 'u2';
  const ACCOUNT = '00000000-0000-4000-8000-000000000900';
  const CATEGORY = '00000000-0000-4000-8000-000000000901';
  const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  function sessionFor(userId: string) {
    return {
      status: 200,
      body: {
        user: {
          id: userId,
          email: `${userId}@example.com`,
          emailVerified: true,
          language: 'es',
          timeZone: 'America/Argentina/Buenos_Aires',
        },
      },
    };
  }

  const created = (n: number) => ({
    status: 201,
    body: {
      id: id(n),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      destinationAccountId: null,
      amount: '100',
      destinationAmount: null,
      occurredAt: '2026-10-02T15:30:00.000Z',
      note: null,
      rate: '14000000',
      rateSource: 'manual',
      rateType: null,
      createdAt: '2026-10-02T15:31:00.000Z',
      tags: [],
    },
  });

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  async function queueFor(userId: string, ...numbers: number[]): Promise<void> {
    const store = await openLocalStore(userId);
    for (const n of numbers) {
      await enqueueMovement(store, {
        id: id(n),
        type: 'expense',
        accountId: ACCOUNT,
        categoryId: CATEGORY,
        amount: '100',
        occurredAt: '2026-10-02T15:30:00.000Z',
        rate: { source: 'manual', value: '14000000' },
      });
    }
    store.close();
  }

  async function queuedIds(userId: string): Promise<string[]> {
    const store = await openLocalStore(userId);
    const items = await loadQueue(store);
    store.close();
    return items.map((item) => item.id).sort();
  }

  async function databaseNames(): Promise<(string | undefined)[]> {
    return (await indexedDB.databases()).map((database) => database.name);
  }

  const sentIds = (calls: { method: string; path: string; body: unknown }[]): string[] =>
    calls
      .filter((call) => call.method === 'POST' && call.path === '/movements')
      .map((call) => (call.body as { id: string }).id)
      .sort();

  function storageEvent(key: string | null, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
    vi.restoreAllMocks();
  });

  it('a session that expires keeps the queue, the copy and the pointer, and redirects to sign-in (AC-01)', async () => {
    await queueFor(ANA, 1, 2);
    writeSessionPointer({ userId: ANA, emailVerified: true });
    const { calls } = stubApi({
      'GET /auth/session': UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
      'POST /movements': created(1),
    });

    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    // The queue is only sent for a user the API confirmed; this answer confirms none, so no send
    // can start after the redirect.
    expect(sentIds(calls)).toEqual([]);
    expect(readSessionPointer()).toEqual({ userId: ANA, emailVerified: true });
    expect(readWipeMarker()).toEqual([]);
    expect(await databaseNames()).toContain(`pesly-${ANA}`);
    expect(await queuedIds(ANA)).toEqual([id(1), id(2)]);
  });

  it('after the expiry, the same user signing in again gets their queue sent with no user action (AC-01)', async () => {
    await queueFor(ANA, 1, 2);
    writeSessionPointer({ userId: ANA, emailVerified: true });
    stubApi({ 'GET /auth/session': UNAUTHENTICATED, 'POST /auth/refresh': UNAUTHENTICATED });
    const expired = renderShell();
    await waitFor(() => {
      expect(expired.router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expired.unmount();

    const { calls } = stubApi({
      'GET /auth/session': sessionFor(ANA),
      'POST /movements': created(1),
    });
    renderShell();

    await waitFor(async () => {
      expect(await queuedIds(ANA)).toEqual([]);
    });
    expect(sentIds(calls)).toEqual([id(1), id(2)]);
  });

  it("with user A's changes queued and user B confirmed, only B's queue is sent and A's stays (AC-02)", async () => {
    await queueFor(ANA, 1, 2);
    await queueFor(BEA, 3);
    writeSessionPointer({ userId: ANA, emailVerified: true });
    const { calls } = stubApi({
      'GET /auth/session': sessionFor(BEA),
      'POST /movements': created(3),
    });

    renderShell();

    await waitFor(async () => {
      expect(await queuedIds(BEA)).toEqual([]);
    });
    // Every pass is started with the confirmed user only (B), so A's queue has no path to be sent.
    expect(sentIds(calls)).toEqual([id(3)]);
    expect(await queuedIds(ANA)).toEqual([id(1), id(2)]);
    expect(readSessionPointer()).toEqual({ userId: BEA, emailVerified: true });
  });

  it('the shell finishes an interrupted wipe on start (AC-04)', async () => {
    await queueFor(BEA, 1);
    localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify([BEA]));
    stubApi({ 'GET /auth/session': sessionFor(ANA) });

    renderShell();

    await waitFor(async () => {
      expect(await databaseNames()).not.toContain(`pesly-${BEA}`);
    });
    // Only the API confirming that user again takes them out of the marker.
    expect(readWipeMarker()).toEqual([BEA]);
  });

  it('the confirmed user is removed from the marker before the pointer is written, so their data can be stored again (AC-04)', async () => {
    localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify([ANA, BEA]));
    const writes: string[] = [];
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      writes.push(key);
      setItem(key, value);
    });
    stubApi({ 'GET /auth/session': sessionFor(ANA) });

    renderShell();
    await screen.findByText('private content');

    expect(readWipeMarker()).toEqual([BEA]);
    expect(writes.indexOf(WIPE_MARKER_KEY)).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf(WIPE_MARKER_KEY)).toBeLessThan(writes.indexOf(SESSION_POINTER_KEY));
    await queueFor(ANA, 1);
    expect(await queuedIds(ANA)).toEqual([id(1)]);
  });

  it('removing the pointer in another tab (a storage event) sends this tab to sign-in (AC-04)', async () => {
    stubApi({ 'GET /auth/session': sessionFor(ANA) });
    const { router, unmount } = renderShell();
    await screen.findByText('private content');
    expect(router.replace).not.toHaveBeenCalled();

    storageEvent(SESSION_POINTER_KEY, null);

    expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    unmount();
    storageEvent(SESSION_POINTER_KEY, null);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it('error: a storage event for another key, or with a value, is ignored (invalid input)', async () => {
    stubApi({ 'GET /auth/session': sessionFor(ANA) });
    const { router } = renderShell();
    await screen.findByText('private content');

    storageEvent(WIPE_MARKER_KEY, null);
    storageEvent('pesly-theme', null);
    storageEvent(null, null);
    storageEvent(SESSION_POINTER_KEY, JSON.stringify({ userId: BEA, emailVerified: true }));

    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByText('private content')).toBeDefined();
  });

  it('error: when IndexedDB is missing the shell starts normally and the marker stays', async () => {
    localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify([BEA]));
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    stubApi({ 'GET /auth/session': sessionFor(ANA) });

    const { router } = renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
    // Without IndexedDB the resumed wipe resolves at once and never writes the marker; the only
    // marker write (for the confirmed user) and any redirect happen before the content shows.
    expect(readWipeMarker()).toEqual([BEA]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
