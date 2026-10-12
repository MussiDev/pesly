// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSettingsContainer } from '../src/features/notifications/containers/notifications-settings-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;
const t = es.notifications;

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const P256DH = `${'B'.repeat(86)}A`;
const AUTH = `${'C'.repeat(21)}A`;
const SUBSCRIPTION = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };
const CONFIG = { status: 200, body: { available: true, publicKey: 'AQIDBA' } };
const STORED = { status: 200, body: { id: '11111111-1111-4111-8111-111111111111' } };
const REMOVED = { status: 204 };
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ORIGINAL_USER_AGENT = navigator.userAgent;

function failure(status: number, code: string) {
  return { status, body: { code, message: 'x' } };
}

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    expirationTime: null,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: SUBSCRIPTION.keys }),
  };
}

interface InstallOptions {
  permission?: NotificationPermission;
  /** What `requestPermission` answers. */
  answer?: NotificationPermission;
  existing?: boolean;
  userAgent?: string;
  withPushApi?: boolean;
}

function install({
  permission = 'default',
  answer = 'granted',
  existing = false,
  userAgent,
  withPushApi = true,
}: InstallOptions = {}) {
  const created = fakeSubscription();
  let current: ReturnType<typeof fakeSubscription> | null = existing ? created : null;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = created;
      return Promise.resolve(created);
    }),
  };
  created.unsubscribe.mockImplementation(() => {
    current = null;
    return Promise.resolve(true);
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  const notification = {
    permission,
    requestPermission: vi.fn(() => {
      notification.permission = answer;
      return Promise.resolve(answer);
    }),
  };
  if (withPushApi) {
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('PushManager', vi.fn());
  } else {
    // `in` checks must see no Push API at all.
    Reflect.deleteProperty(globalThis, 'Notification');
    Reflect.deleteProperty(globalThis, 'PushManager');
  }
  if (userAgent !== undefined) {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  }
  return { pushManager, created, requestPermission: notification.requestPermission };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Object.defineProperty(navigator, 'userAgent', {
    value: ORIGINAL_USER_AGENT,
    configurable: true,
  });
});

function paths(calls: { method: string; path: string }[]) {
  return calls.map((call) => `${call.method} ${call.path}`);
}

describe('NotificationsSettingsContainer', () => {
  it('asks for the permission only when "Enable notifications" is tapped (AC-46, AC-47)', async () => {
    const { requestPermission } = install();
    stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    const enable = await screen.findByRole('button', { name: t.actions.enable });
    expect(screen.getByText(t.status.off)).toBeDefined();
    expect(requestPermission).not.toHaveBeenCalled();

    await userEvent.setup().click(enable);

    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('subscribes with the server key, stores the subscription and shows on (AC-48)', async () => {
    const { pushManager } = install();
    const { calls } = stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: t.actions.enable }));

    expect(await screen.findByText(t.status.on)).toBeDefined();
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([
      { method: 'PUT', path: '/push/subscriptions', body: SUBSCRIPTION },
    ]);
    expect(screen.getByRole('button', { name: t.actions.disable })).toBeDefined();
  });

  it('stores nothing and shows blocked with the browser-settings help when the permission is denied (AC-49)', async () => {
    const { pushManager } = install({ answer: 'denied' });
    const { calls } = stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: t.actions.enable }));

    expect(await screen.findByText(t.blocked.help)).toBeDefined();
    expect(screen.queryByRole('button', { name: t.actions.enable })).toBeNull();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(paths(calls)).toEqual(['GET /push/config']);
  });

  it('shows blocked without asking when the browser already denies notifications (AC-49)', async () => {
    const { requestPermission } = install({ permission: 'denied' });
    stubApi({ 'GET /push/config': CONFIG });
    renderApp(<NotificationsSettingsContainer />);

    expect(await screen.findByText(t.blocked.help)).toBeDefined();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('removes the browser subscription and shows an error with a retry when the server answers 400 (AC-50)', async () => {
    const { created } = install();
    stubApi({
      'GET /push/config': CONFIG,
      'PUT /push/subscriptions': [failure(400, 'VALIDATION_FAILED'), STORED],
    });
    renderApp(<NotificationsSettingsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.actions.enable }));

    expect(await screen.findByText(t.errors.enable)).toBeDefined();
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.status.off)).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText(t.status.on)).toBeDefined();
    expect(screen.queryByText(t.errors.enable)).toBeNull();
  });

  it('removes the subscription on the server and in the browser and shows off (AC-51)', async () => {
    const { created } = install({ permission: 'granted', existing: true });
    const { calls } = stubApi({
      'GET /push/config': CONFIG,
      'PUT /push/subscriptions': STORED,
      'POST /push/subscriptions/unsubscribe': REMOVED,
    });
    renderApp(<NotificationsSettingsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: t.actions.disable }));

    expect(await screen.findByText(t.status.off)).toBeDefined();
    expect(calls.filter((call) => call.path.endsWith('/unsubscribe'))).toEqual([
      { method: 'POST', path: '/push/subscriptions/unsubscribe', body: { endpoint: ENDPOINT } },
    ]);
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: t.actions.enable })).toBeDefined();
  });

  it('shows on for this device with a granted permission and a browser subscription (AC-52)', async () => {
    install({ permission: 'granted', existing: true });
    stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    expect(await screen.findByText(t.status.on)).toBeDefined();
  });

  it('keeps notifications on and offers a retry when the server cannot remove the subscription (AC-53)', async () => {
    const { created } = install({ permission: 'granted', existing: true });
    stubApi({
      'GET /push/config': CONFIG,
      'PUT /push/subscriptions': STORED,
      'POST /push/subscriptions/unsubscribe': [failure(500, 'INTERNAL'), REMOVED],
    });
    renderApp(<NotificationsSettingsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.actions.disable }));

    expect(await screen.findByText(t.errors.disable)).toBeDefined();
    expect(screen.getByText(t.status.on)).toBeDefined();
    expect(created.unsubscribe).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText(t.status.off)).toBeDefined();
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('treats a 404 on disable as already removed: shows off and removes the browser subscription (AC-51)', async () => {
    const { created } = install({ permission: 'granted', existing: true });
    stubApi({
      'GET /push/config': CONFIG,
      'PUT /push/subscriptions': STORED,
      'POST /push/subscriptions/unsubscribe': failure(404, 'NOT_FOUND'),
    });
    renderApp(<NotificationsSettingsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: t.actions.disable }));

    expect(await screen.findByText(t.status.off)).toBeDefined();
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('explains the Home Screen on an iPhone outside it and never asks for the permission (AC-54)', async () => {
    const { requestPermission, pushManager } = install({ userAgent: IPHONE, withPushApi: false });
    const { calls } = stubApi({ 'GET /push/config': CONFIG });
    renderApp(<NotificationsSettingsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: t.actions.enable }));

    expect(await screen.findByText(t.install.description)).toBeDefined();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('says the browser cannot receive push and offers no enable control without the Push API (AC-55)', async () => {
    install({ withPushApi: false });
    stubApi({ 'GET /push/config': CONFIG });
    renderApp(<NotificationsSettingsContainer />);

    expect(await screen.findByText(t.unsupported.description)).toBeDefined();
    expect(screen.queryByRole('button', { name: t.actions.enable })).toBeNull();
  });

  it('sends the existing browser subscription to the server each time the screen opens (AC-57)', async () => {
    install({ permission: 'granted', existing: true });
    const { calls } = stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    await screen.findByText(t.status.on);

    expect(calls.filter((call) => call.method === 'PUT')).toEqual([
      { method: 'PUT', path: '/push/subscriptions', body: SUBSCRIPTION },
    ]);
  });

  it('keeps notifications on with a retryable message when the re-registration fails (FR-21)', async () => {
    install({ permission: 'granted', existing: true });
    const { calls } = stubApi({
      'GET /push/config': CONFIG,
      'PUT /push/subscriptions': ['network-error', STORED],
    });
    renderApp(<NotificationsSettingsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByText(t.errors.sync)).toBeDefined();
    expect(screen.getByText(t.status.on)).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.app.retry }));

    await waitFor(() => {
      expect(screen.queryByText(t.errors.sync)).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
  });

  it('shows off and calls no store route without a browser subscription (AC-58)', async () => {
    install({ permission: 'granted', existing: false });
    const { calls } = stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    renderApp(<NotificationsSettingsContainer />);

    expect(await screen.findByText(t.status.off)).toBeDefined();
    expect(paths(calls)).toEqual(['GET /push/config']);
  });

  it('shows an error state with a retry when the configuration cannot be loaded (FR-05)', async () => {
    install();
    stubApi({ 'GET /push/config': [failure(500, 'INTERNAL'), CONFIG] });
    renderApp(<NotificationsSettingsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByText(t.errors.config)).toBeDefined();
    expect(screen.queryByRole('button', { name: t.actions.enable })).toBeNull();

    await user.click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByRole('button', { name: t.actions.enable })).toBeDefined();
  });

  it('offers no enable control when the server has no push configured', async () => {
    install();
    stubApi({ 'GET /push/config': { status: 200, body: { available: false, publicKey: null } } });
    renderApp(<NotificationsSettingsContainer />);

    expect(await screen.findByText(t.unavailable.description)).toBeDefined();
    expect(screen.queryByRole('button', { name: t.actions.enable })).toBeNull();
  });

  it('disables the controls and says so while offline', async () => {
    install({ permission: 'granted', existing: true });
    stubApi({ 'GET /push/config': CONFIG, 'PUT /push/subscriptions': STORED });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp(<NotificationsSettingsContainer />);

    const disable = await screen.findByRole('button', { name: t.actions.disable });

    expect((disable as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(t.offline)).toBeDefined();
    vi.restoreAllMocks();
  });

  it('renders in English with the English catalog', async () => {
    install();
    stubApi({ 'GET /push/config': CONFIG });
    renderApp(<NotificationsSettingsContainer />, { locale: 'en' });

    expect(
      await screen.findByRole('button', { name: en.notifications.actions.enable }),
    ).toBeDefined();
  });

  it('redirects to sign-in when the configuration answers 401', async () => {
    install();
    stubApi({ 'GET /push/config': failure(401, 'UNAUTHENTICATED') });
    const { router } = renderApp(<NotificationsSettingsContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});
