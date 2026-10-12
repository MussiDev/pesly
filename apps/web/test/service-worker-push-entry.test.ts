import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('serwist', () => ({
  Serwist: class {
    addEventListeners = vi.fn();
  },
}));

const listeners = new Map<string, (event: unknown) => void>();
const showNotification = vi.fn(() => Promise.resolve());

beforeEach(() => {
  listeners.clear();
  showNotification.mockClear();
  vi.resetModules();
  vi.stubGlobal('self', {
    __SW_MANIFEST: [],
    location: { origin: 'https://pesly.test' },
    navigator: { onLine: true },
    clients: { matchAll: vi.fn(() => Promise.resolve([])), openWindow: vi.fn() },
    registration: { showNotification },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service worker entry', () => {
  it('registers push and notificationclick next to the untouched message and fetch listeners (FR-16)', async () => {
    await import('../src/app/sw');

    expect([...listeners.keys()].sort()).toEqual(['fetch', 'message', 'notificationclick', 'push']);
  });

  it('keeps the push event alive with waitUntil and shows a notification', async () => {
    await import('../src/app/sw');
    const waitUntil = vi.fn();

    listeners.get('push')?.({ data: { text: () => 'not json' }, waitUntil });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await (waitUntil.mock.calls[0] as unknown[])[0];
    expect(showNotification).toHaveBeenCalledWith('Pesly', expect.anything());
  });

  it('keeps the click event alive with waitUntil', async () => {
    await import('../src/app/sw');
    const waitUntil = vi.fn();

    listeners.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { url: '/es/notices' } },
      waitUntil,
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await (waitUntil.mock.calls[0] as unknown[])[0];
  });
});
