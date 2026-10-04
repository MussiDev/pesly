// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceWorkerRegistrar } from '../src/components/service-worker-registrar';

const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function setServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('ServiceWorkerRegistrar', () => {
  it('registers the worker with the whole origin as its scope when enabled (FR-04)', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    setServiceWorker({ register });

    render(<ServiceWorkerRegistrar enabled />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(1);
    });
    expect(register).toHaveBeenCalledWith('/serwist/sw.js', { scope: '/' });
  });

  it('registers nothing when it is disabled, as in development (FR-04)', () => {
    const register = vi.fn(() => Promise.resolve({}));
    setServiceWorker({ register });

    render(<ServiceWorkerRegistrar enabled={false} />);

    expect(register).not.toHaveBeenCalled();
  });

  it('leaves the app working and throws nothing when the registration fails with an error (FR-04)', async () => {
    const register = vi.fn(() => Promise.reject(new Error('SecurityError')));
    setServiceWorker({ register });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const view = render(
      <>
        <ServiceWorkerRegistrar enabled />
        <p>the app</p>
      </>,
    );
    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(view.getByText('the app')).toBeDefined();
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('does nothing in a browser without service workers (FR-04)', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');

    expect(() => render(<ServiceWorkerRegistrar enabled />)).not.toThrow();
  });
});
