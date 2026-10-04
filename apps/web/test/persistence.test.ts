import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from '../src/lib/local-store/persistence';

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('asks the browser once and reports granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });

    await expect(requestPersistentStorage()).resolves.toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when the storage is already persistent', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });

    await expect(requestPersistentStorage()).resolves.toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports denied when the browser refuses', async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    });

    await expect(requestPersistentStorage()).resolves.toBe('denied');
  });

  it('reports denied, and does not throw, when the request fails with an error', async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error('blocked')),
    });

    await expect(requestPersistentStorage()).resolves.toBe('denied');
  });

  it('reports unsupported when the Storage API is missing', async () => {
    stubStorage(undefined);

    await expect(requestPersistentStorage()).resolves.toBe('unsupported');
  });

  it('reports unsupported when persist is not a function', async () => {
    stubStorage({ persisted: vi.fn() });

    await expect(requestPersistentStorage()).resolves.toBe('unsupported');
  });
});
