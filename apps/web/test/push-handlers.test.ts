import { describe, expect, it, vi } from 'vitest';
import {
  handleNotificationClick,
  handlePush,
  resolveTarget,
  type WindowClientLike,
  type WorkerDeps,
} from '../src/lib/service-worker/push-handlers';

const ORIGIN = 'https://pesly.test';
const NOTICE_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

function makeDeps(clients: WindowClientLike[] = []) {
  return {
    showNotification: vi.fn<WorkerDeps['showNotification']>(() => Promise.resolve()),
    matchAll: vi.fn<WorkerDeps['matchAll']>(() => Promise.resolve(clients)),
    openWindow: vi.fn<WorkerDeps['openWindow']>(() => Promise.resolve(null)),
    origin: ORIGIN,
  };
}

function makeClient(overrides: Partial<WindowClientLike> = {}) {
  return {
    url: `${ORIGIN}/es/movements`,
    focus: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
    ...overrides,
  } satisfies WindowClientLike;
}

describe('handlePush', () => {
  it('shows the payload title and body tagged with the notice id (AC-41)', async () => {
    const deps = makeDeps();
    const text = JSON.stringify({
      noticeId: NOTICE_ID,
      title: 'Pesly',
      body: 'A payment is due',
      url: '/es/notices',
    });

    await handlePush(text, deps);

    expect(deps.showNotification).toHaveBeenCalledTimes(1);
    expect(deps.showNotification).toHaveBeenCalledWith('Pesly', {
      body: 'A payment is due',
      tag: NOTICE_ID,
      data: { url: '/es/notices' },
    });
  });

  it.each([
    ['a missing payload', null],
    ['an empty string', ''],
    ['text that is not JSON', 'not json {'],
    [
      'JSON that fails the schema',
      JSON.stringify({ noticeId: 'nope', title: 'x', body: '', url: '/' }),
    ],
  ])('shows the generic notification for %s (AC-42)', async (_label, text) => {
    const deps = makeDeps();

    await handlePush(text, deps);

    expect(deps.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = deps.showNotification.mock.calls[0] ?? ['', { data: { url: '' } }];
    expect(title).toBe('Pesly');
    expect(options.body).toBeUndefined();
    expect(options.data).toEqual({ url: '/' });
  });

  it('passes a rejected showNotification to the caller so waitUntil reports it', async () => {
    const deps = makeDeps();
    deps.showNotification.mockRejectedValueOnce(new Error('denied'));

    await expect(handlePush(null, deps)).rejects.toThrow('denied');
  });
});

describe('resolveTarget', () => {
  it.each([
    ['https://evil.example/x'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    [undefined],
    [42],
    [''],
  ])('opens the root for %s (AC-45)', (url) => {
    expect(resolveTarget(url, ORIGIN)).toBe('/');
  });

  it('keeps a same-origin path and its query as is (AC-45)', () => {
    expect(resolveTarget('/es/notices', ORIGIN)).toBe('/es/notices');
    expect(resolveTarget('/es/notices?id=1', ORIGIN)).toBe('/es/notices?id=1');
  });
});

describe('handleNotificationClick', () => {
  it('closes the notification, focuses an open window of the origin and navigates it (AC-43)', async () => {
    const other = makeClient({ url: 'https://other.example/x' });
    const client = makeClient();
    const deps = makeDeps([other, client]);
    const notification = { close: vi.fn(), data: { url: '/es/notices' } };

    await handleNotificationClick(notification, deps);

    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/es/notices`);
    expect(other.focus).not.toHaveBeenCalled();
    expect(deps.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window on the link when no window of the origin is open (AC-44)', async () => {
    const deps = makeDeps([makeClient({ url: 'https://other.example/x' })]);

    await handleNotificationClick({ close: vi.fn(), data: { url: '/es/notices' } }, deps);

    expect(deps.openWindow).toHaveBeenCalledWith(`${ORIGIN}/es/notices`);
  });

  it('opens a window when navigate fails (AC-44)', async () => {
    const failing = makeClient({ navigate: vi.fn(() => Promise.reject(new Error('boom'))) });
    const deps = makeDeps([failing]);

    await handleNotificationClick({ close: vi.fn(), data: { url: '/es/notices' } }, deps);

    expect(deps.openWindow).toHaveBeenCalledWith(`${ORIGIN}/es/notices`);
  });

  it('opens a window when navigate is unavailable (AC-44)', async () => {
    const deps = makeDeps([
      { url: `${ORIGIN}/es/movements`, focus: vi.fn(() => Promise.resolve()) },
    ]);

    await handleNotificationClick({ close: vi.fn(), data: { url: '/es/notices' } }, deps);

    expect(deps.openWindow).toHaveBeenCalledWith(`${ORIGIN}/es/notices`);
  });

  it.each([
    ['https://evil.example/x'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
  ])('opens the root for the link %s (AC-45)', async (url) => {
    const deps = makeDeps();

    await handleNotificationClick({ close: vi.fn(), data: { url } }, deps);

    expect(deps.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('opens the root when the notification carries no data (AC-45)', async () => {
    const deps = makeDeps();

    await handleNotificationClick({ close: vi.fn() }, deps);

    expect(deps.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
