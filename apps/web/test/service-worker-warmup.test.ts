// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestShellWarmup } from '../src/lib/service-worker/warmup';

const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function setServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('requestShellWarmup', () => {
  it('asks the active worker to cache the list and the entry screen of the locale (FR-04)', async () => {
    const postMessage = vi.fn();
    setServiceWorker({ ready: Promise.resolve({ active: { postMessage } }) });

    const sent = await requestShellWarmup('es');

    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'PESLY_CACHE_URLS',
      urls: ['/es/movements', '/es/movements/new'],
    });
  });

  it('does nothing, and raises no error, in a browser without service workers (FR-04)', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');

    await expect(requestShellWarmup('es')).resolves.toBe(false);
  });

  it('answers false when the worker never becomes ready or has no active one (FR-04)', async () => {
    setServiceWorker({ ready: Promise.reject(new Error('registration failed')) });
    await expect(requestShellWarmup('es')).resolves.toBe(false);

    setServiceWorker({ ready: Promise.resolve({ active: null }) });
    await expect(requestShellWarmup('es')).resolves.toBe(false);
  });
});
