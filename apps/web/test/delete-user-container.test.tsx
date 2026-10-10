// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteUserContainer } from '../src/features/profile/containers/delete-user-container';
import { enqueueMovement, loadQueue } from '../src/lib/local-store/queue';
import {
  readSessionPointer,
  writeSessionPointer,
  type SessionPointer,
} from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { readWipeMarker } from '../src/lib/local-store/wipe-marker';
import type * as SyncQueue from '../src/lib/sync/sync-queue';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { cancelSyncRetry } = vi.hoisted(() => ({ cancelSyncRetry: vi.fn() }));

vi.mock('../src/lib/sync/sync-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncQueue>();
  return {
    ...actual,
    cancelSyncRetry: () => {
      cancelSyncRetry();
      actual.cancelSyncRetry();
    },
  };
});

const { es } = CATALOGS;

const AUTHORIZATION_URL = 'https://accounts.google.test/authorize?state=abc&prompt=login';

function profile(overrides: {
  twoFactorEnabled?: boolean;
  deletionReauth?: 'password' | 'google';
}) {
  return {
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: {
        defaultRateType: 'blue',
        displayCurrency: 'ARS',
        timeZone: 'UTC',
        language: 'es',
      },
      ...overrides,
    },
  };
}

function failure(status: number, code: string) {
  return { status, body: { code } };
}

function openAt(search: string) {
  window.history.replaceState(null, '', `/es/settings/delete-account${search}`);
}

const passwordField = () => screen.getByLabelText<HTMLInputElement>(es.deleteUser.password);
const codeField = () => screen.getByLabelText<HTMLInputElement>(es.deleteUser.code);
const submit = () => screen.getByRole('button', { name: es.deleteUser.submit });
const hintTitle = () => screen.queryByText(es.deleteUser.setPassword.title);
const hintLink = () => screen.queryByRole('link', { name: es.deleteUser.setPassword.link });
const googleStep = () => screen.getByRole('button', { name: es.deleteUser.google.continue });

async function loadedPasswordForm() {
  await screen.findByLabelText(es.deleteUser.password);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeleteUserContainer, password path', () => {
  it('posts the password and goes to sign-in on 204 (AC-01)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile({}),
      'POST /profile/delete': { status: 204 },
    });
    const { router } = renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    expect(screen.queryByLabelText(es.deleteUser.code)).toBeNull();
    expect(screen.queryByRole('button', { name: es.deleteUser.google.continue })).toBeNull();
    await user.type(passwordField(), 'correct horse battery');
    await user.click(submit());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/profile/delete', body: { password: 'correct horse battery' } },
    ]);
  });

  it('posts the password and the trimmed code when 2FA is on (AC-03)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile({ twoFactorEnabled: true }),
      'POST /profile/delete': { status: 204 },
    });
    const { router } = renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    await user.type(passwordField(), 'correct horse battery');
    await user.type(codeField(), ' 123456 ');
    await user.click(submit());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/profile/delete',
      body: { password: 'correct horse battery', secondFactorCode: '123456' },
    });
  });

  it('shows the wrong password, stays on the screen and clears the password (AC-02, sad path)', async () => {
    stubApi({
      'GET /profile': profile({}),
      'POST /profile/delete': failure(401, 'INVALID_CREDENTIALS'),
    });
    const { router } = renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    await user.type(passwordField(), 'wrong password here');
    await user.click(submit());

    expect(await screen.findByText(es.errors.invalidCredentials)).toBeDefined();
    expect(passwordField().value).toBe('');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows a wrong second-factor code on its field and clears both fields (AC-04, sad path)', async () => {
    stubApi({
      'GET /profile': profile({ twoFactorEnabled: true }),
      'POST /profile/delete': failure(400, 'TOTP_INVALID'),
    });
    const { router } = renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    await user.type(passwordField(), 'correct horse battery');
    await user.type(codeField(), '000000');
    await user.click(submit());

    expect(await screen.findByText(es.errors.codeInvalid)).toBeDefined();
    expect(codeField().value).toBe('');
    expect(passwordField().value).toBe('');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['a rate limit', failure(429, 'RATE_LIMITED'), es.errors.retryLater],
    ['a server error', failure(500, 'INTERNAL'), es.errors.unexpected],
    ['a network failure', 'network-error' as const, es.errors.network],
  ])(
    'shows the message for %s, clears the password and can be resubmitted (AC-05, sad path)',
    async (_name, answer, message) => {
      const { calls } = stubApi({
        'GET /profile': profile({}),
        'POST /profile/delete': [answer, { status: 204 }],
      });
      const { router } = renderApp(<DeleteUserContainer />);
      await loadedPasswordForm();
      const user = userEvent.setup();

      await user.type(passwordField(), 'correct horse battery');
      await user.click(submit());

      expect(await screen.findByText(message)).toBeDefined();
      expect(passwordField().value).toBe('');
      expect(router.replace).not.toHaveBeenCalled();

      await user.type(passwordField(), 'correct horse battery');
      await user.click(submit());
      await waitFor(() => {
        expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
      });
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    },
  );

  it.each([
    ['an empty password', '', es.errors.passwordRequired],
    ['a 129-character password', 'a'.repeat(129), es.errors.passwordTooLong],
  ])('rejects %s on the client without a request (sad path)', async (_name, password, message) => {
    const { calls } = stubApi({ 'GET /profile': profile({}) });
    renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    if (password) {
      await user.click(passwordField());
      await user.paste(password);
    }
    await user.click(submit());

    expect(await screen.findByText(message)).toBeDefined();
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('rejects a malformed second-factor code on the client without a request (sad path)', async () => {
    const { calls } = stubApi({ 'GET /profile': profile({ twoFactorEnabled: true }) });
    renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    await user.type(passwordField(), 'correct horse battery');
    await user.type(codeField(), '12-34');
    await user.click(submit());

    expect(await screen.findByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('asks for the code when 2FA is on and none was typed, without a request (sad path)', async () => {
    const { calls } = stubApi({ 'GET /profile': profile({ twoFactorEnabled: true }) });
    renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();
    const user = userEvent.setup();

    await user.type(passwordField(), 'correct horse battery');
    await user.click(submit());

    expect(await screen.findByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('never shows the Google step to a user with a password, even with ?reauth=ready (AC-10)', async () => {
    openAt('?reauth=ready');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'password' }) });
    renderApp(<DeleteUserContainer />);
    await loadedPasswordForm();

    expect(screen.queryByRole('button', { name: es.deleteUser.google.continue })).toBeNull();
    expect(screen.queryByText(es.deleteUser.google.confirmed)).toBeNull();
    expect(passwordField()).toBeDefined();
  });

  it('goes to sign-in when the session is gone on load (sad path)', async () => {
    stubApi({
      'GET /profile': failure(401, 'UNAUTHENTICATED'),
      'POST /auth/refresh': failure(401, 'UNAUTHENTICATED'),
    });
    const { router } = renderApp(<DeleteUserContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('shows a skeleton with a loading status while the profile loads (AC-21)', async () => {
    stubApi({ 'GET /profile': profile({}) });
    renderApp(<DeleteUserContainer />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe(es.app.loading);
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await loadedPasswordForm();
  });

  it('shows the load failure in the shared error state, with no stale form (sad path)', async () => {
    stubApi({ 'GET /profile': failure(500, 'INTERNAL') });
    renderApp(<DeleteUserContainer />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(es.ui.error.title);
    expect(alert.textContent).toContain(es.errors.unexpected);
    expect(within(alert).getByRole('button', { name: es.app.retry })).toBeDefined();
    expect(screen.queryByLabelText(es.deleteUser.password)).toBeNull();
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
  });

  it('shows the load failure with a retry (sad path)', async () => {
    stubApi({ 'GET /profile': [failure(500, 'INTERNAL'), profile({})] });
    renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.app.retry }));

    await loadedPasswordForm();
  });
});

describe('DeleteUserContainer, Google path', () => {
  it('shows the first step with no password field and goes to the URL Google needs (AC-06)', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { calls } = stubApi({
      'GET /profile': profile({ deletionReauth: 'google' }),
      'POST /profile/delete/google/start': {
        status: 200,
        body: { authorizationUrl: AUTHORIZATION_URL },
      },
    });
    renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.deleteUser.google.continue }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(AUTHORIZATION_URL);
    });
    expect(screen.queryByLabelText(es.deleteUser.password)).toBeNull();
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/profile/delete/google/start', body: {} },
    ]);
  });

  it('shows the message and keeps the first step when the start fails (sad path)', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    stubApi({
      'GET /profile': profile({ deletionReauth: 'google' }),
      'POST /profile/delete/google/start': failure(429, 'RATE_LIMITED'),
    });
    renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.deleteUser.google.continue }));

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(googleStep()).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });

  it('with ?reauth=ready shows the final form and deletes with no password (AC-08)', async () => {
    openAt('?reauth=ready');
    const { calls } = stubApi({
      'GET /profile': profile({ deletionReauth: 'google' }),
      'POST /profile/delete': { status: 204 },
    });
    const { router } = renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.deleteUser.submit }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByLabelText(es.deleteUser.password)).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/profile/delete', body: {} },
    ]);
  });

  it('with ?reauth=ready and 2FA asks for the code and sends only the code (AC-08, AC-04)', async () => {
    openAt('?reauth=ready');
    const { calls } = stubApi({
      'GET /profile': profile({ deletionReauth: 'google', twoFactorEnabled: true }),
      'POST /profile/delete': [failure(400, 'TOTP_INVALID'), { status: 204 }],
    });
    const { router } = renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();
    await screen.findByLabelText(es.deleteUser.code);

    await user.type(codeField(), '000000');
    await user.click(submit());
    expect(await screen.findByText(es.errors.codeInvalid)).toBeDefined();
    expect(codeField().value).toBe('');
    expect(router.replace).not.toHaveBeenCalled();

    await user.type(codeField(), '123456');
    await user.click(submit());
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { secondFactorCode: '000000' },
      { secondFactorCode: '123456' },
    ]);
  });

  it('with ?reauth=failed shows the failure message and the first step again (AC-07, sad path)', async () => {
    openAt('?reauth=failed');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'google' }) });
    renderApp(<DeleteUserContainer />);

    expect(await screen.findByText(es.deleteUser.google.failed)).toBeDefined();
    expect(googleStep()).toBeDefined();
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
  });

  it('offers to start again when the grant expired: 401 REAUTHENTICATION_REQUIRED (AC-09, sad path)', async () => {
    openAt('?reauth=ready');
    stubApi({
      'GET /profile': profile({ deletionReauth: 'google' }),
      'POST /profile/delete': failure(401, 'REAUTHENTICATION_REQUIRED'),
    });
    const { router } = renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.deleteUser.submit }));

    expect(await screen.findByText(es.errors.reauthenticationRequired)).toBeDefined();
    expect(googleStep()).toBeDefined();
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('ignores any other value of the reauth flag (sad path)', async () => {
    openAt('?reauth=token-abc');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'google' }) });
    renderApp(<DeleteUserContainer />);

    expect(
      await screen.findByRole('button', { name: es.deleteUser.google.continue }),
    ).toBeDefined();
    expect(screen.queryByText(es.deleteUser.google.failed)).toBeNull();
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
  });

  it('always shows a short set-a-password note with the forgot-password link under the Google step (O-2)', async () => {
    openAt('');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'google' }) });
    renderApp(<DeleteUserContainer />);

    await screen.findByRole('button', { name: es.deleteUser.google.continue });
    expect(screen.getByText(es.deleteUser.setPassword.note)).toBeDefined();
    expect(hintLink()?.getAttribute('href')).toBe('/es/forgot-password');
    expect(hintTitle()).toBeNull();
  });

  it('with ?reauth=failed shows the prominent hint with the failure message (O-2)', async () => {
    openAt('?reauth=failed');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'google' }) });
    renderApp(<DeleteUserContainer />);

    expect(await screen.findByText(es.deleteUser.google.failed)).toBeDefined();
    expect(hintTitle()).not.toBeNull();
    expect(screen.getByText(es.deleteUser.setPassword.body)).toBeDefined();
    expect(hintLink()?.getAttribute('href')).toBe('/es/forgot-password');
    expect(screen.queryByText(es.deleteUser.setPassword.note)).toBeNull();
  });

  it('when the delete answers REAUTHENTICATION_REQUIRED shows the prominent hint (O-2)', async () => {
    openAt('?reauth=ready');
    stubApi({
      'GET /profile': profile({ deletionReauth: 'google' }),
      'POST /profile/delete': failure(401, 'REAUTHENTICATION_REQUIRED'),
    });
    renderApp(<DeleteUserContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.deleteUser.submit }));

    expect(await screen.findByText(es.errors.reauthenticationRequired)).toBeDefined();
    expect(hintTitle()).not.toBeNull();
    expect(hintLink()?.getAttribute('href')).toBe('/es/forgot-password');
  });

  it('does not show the hint on the confirmed final form (O-2)', async () => {
    openAt('?reauth=ready');
    stubApi({ 'GET /profile': profile({ deletionReauth: 'google' }) });
    renderApp(<DeleteUserContainer />);

    await screen.findByRole('button', { name: es.deleteUser.submit });
    expect(hintTitle()).toBeNull();
    expect(hintLink()).toBeNull();
  });
});

describe('DeleteUserContainer, local data (DISC-001-04d)', () => {
  const USER = 'u1';
  const MOVEMENT = '00000000-0000-4000-8000-000000000001';

  async function seedQueue(): Promise<void> {
    const store = await openLocalStore(USER);
    await enqueueMovement(store, {
      id: MOVEMENT,
      type: 'expense',
      accountId: '00000000-0000-4000-8000-000000000900',
      categoryId: '00000000-0000-4000-8000-000000000901',
      amount: '100',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'manual', value: '14000000' },
    });
    store.close();
  }

  async function queuedCount(): Promise<number> {
    const store = await openLocalStore(USER);
    const items = await loadQueue(store);
    store.close();
    return items.length;
  }

  async function databaseNames(): Promise<(string | undefined)[]> {
    return (await indexedDB.databases()).map((database) => database.name);
  }

  async function submitPassword(): Promise<void> {
    await loadedPasswordForm();
    const user = userEvent.setup();
    await user.type(passwordField(), 'correct horse battery');
    await user.click(submit());
  }

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    openAt('');
    writeSessionPointer({ userId: USER, emailVerified: true });
    await seedQueue();
  });

  it('a successful account deletion wipes the local data before going to sign-in (AC-04)', async () => {
    stubApi({ 'GET /profile': profile({}), 'POST /profile/delete': { status: 204 } });
    const { router } = renderApp(<DeleteUserContainer />);
    let atRedirect:
      | { pointer: SessionPointer | null; marker: string[]; names: Promise<(string | undefined)[]> }
      | undefined;
    router.replace.mockImplementation(() => {
      atRedirect = {
        pointer: readSessionPointer(),
        marker: readWipeMarker(),
        names: databaseNames(),
      };
    });

    await submitPassword();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(atRedirect?.pointer).toBeNull();
    expect(atRedirect?.marker).toEqual([USER]);
    expect(await atRedirect?.names).not.toContain(`pesly-${USER}`);
  });

  it('a successful account deletion cancels the scheduled sync retry (AC-04)', async () => {
    stubApi({ 'GET /profile': profile({}), 'POST /profile/delete': { status: 204 } });
    const { router } = renderApp(<DeleteUserContainer />);
    cancelSyncRetry.mockClear();
    let cancelledAtRedirect: number | undefined;
    router.replace.mockImplementation(() => {
      cancelledAtRedirect = cancelSyncRetry.mock.calls.length;
    });

    await submitPassword();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(cancelledAtRedirect).toBe(1);
  });

  it('error: an account deletion answered 401 redirects and keeps the local data', async () => {
    stubApi({
      'GET /profile': profile({}),
      'POST /profile/delete': failure(401, 'UNAUTHENTICATED'),
      'POST /auth/refresh': failure(401, 'UNAUTHENTICATED'),
    });
    const { router } = renderApp(<DeleteUserContainer />);

    await submitPassword();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    // The 401 branch redirects and returns; it never reaches the wipe, so nothing is still running.
    expect(readSessionPointer()).toEqual({ userId: USER, emailVerified: true });
    expect(readWipeMarker()).toEqual([]);
    expect(await databaseNames()).toContain(`pesly-${USER}`);
    expect(await queuedCount()).toBe(1);
  });

  it('error: a failed account deletion wipes nothing', async () => {
    stubApi({ 'GET /profile': profile({}), 'POST /profile/delete': failure(500, 'INTERNAL') });
    const { router } = renderApp(<DeleteUserContainer />);

    await submitPassword();

    // The error is shown by the failure branch, which never reaches the wipe or the redirect.
    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(readSessionPointer()).toEqual({ userId: USER, emailVerified: true });
    expect(readWipeMarker()).toEqual([]);
    expect(await databaseNames()).toContain(`pesly-${USER}`);
    expect(await queuedCount()).toBe(1);
  });
});

describe('DeleteUserContainer, password path never shows the set-password hint (O-2)', () => {
  it.each(['', '?reauth=failed', '?reauth=ready'])('with %j', async (search) => {
    openAt(search);
    stubApi({ 'GET /profile': profile({}) });
    renderApp(<DeleteUserContainer />);

    await loadedPasswordForm();
    expect(hintTitle()).toBeNull();
    expect(hintLink()).toBeNull();
    expect(screen.queryByText(es.deleteUser.setPassword.note)).toBeNull();
  });
});
