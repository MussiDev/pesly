import { describe, expect, it, vi } from 'vitest';
import { cacheRequestedUrls } from '../src/lib/service-worker/cache-urls';

const ORIGIN = 'https://pesly.test';

function page(url: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    redirected: false,
    type: 'basic',
    url,
    headers: {
      get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null),
    },
    ...overrides,
  };
}

function setup(answer: (url: string) => Promise<unknown>) {
  const put = vi.fn<(url: string, response: unknown) => Promise<void>>(() => Promise.resolve());
  const fetched: string[] = [];
  const deps = {
    origin: ORIGIN,
    fetch: (request: { url: string }) => {
      fetched.push(request.url);
      return answer(request.url) as Promise<never>;
    },
    open: () => Promise.resolve({ put }),
  };
  return { deps, put, fetched };
}

describe('cacheRequestedUrls', () => {
  it('fetches and stores an accepted URL (FR-04)', async () => {
    const { deps, put, fetched } = setup((url) => Promise.resolve(page(url)));

    const cached = await cacheRequestedUrls(['/es/movements', '/es/movements/new'], deps);

    expect(cached).toEqual(['/es/movements', '/es/movements/new']);
    expect(fetched).toEqual([`${ORIGIN}/es/movements`, `${ORIGIN}/es/movements/new`]);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('ignores an invalid URL and one whose fetch fails, and stores the rest (FR-04)', async () => {
    const { deps, put, fetched } = setup((url) =>
      url.endsWith('/boom') ? Promise.reject(new Error('offline')) : Promise.resolve(page(url)),
    );

    const cached = await cacheRequestedUrls(
      ['https://evil.test/x', '/es/boom', '//evil.test/y', '/es/movements'],
      deps,
    );

    expect(cached).toEqual(['/es/movements']);
    expect(fetched).toEqual([`${ORIGIN}/es/boom`, `${ORIGIN}/es/movements`]);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('does not store a redirected or non-HTML answer, so a sign-in bounce is never kept (FR-04)', async () => {
    const { deps, put } = setup((url) =>
      Promise.resolve(
        url.endsWith('/redirected')
          ? page(url, { redirected: true })
          : page(url, { headers: { get: () => 'application/json' } }),
      ),
    );

    const cached = await cacheRequestedUrls(['/es/redirected', '/es/data'], deps);

    expect(cached).toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });

  it('answers an empty list, and fetches nothing, for a message that is not a list (FR-04)', async () => {
    const { deps, fetched } = setup((url) => Promise.resolve(page(url)));

    expect(await cacheRequestedUrls('/es/movements', deps)).toEqual([]);
    expect(await cacheRequestedUrls(undefined, deps)).toEqual([]);
    expect(fetched).toEqual([]);
  });
});
