import { describe, expect, it } from 'vitest';
import {
  acceptedCacheUrls,
  isCacheableDocument,
  isFrameworkFetch,
  shouldServeFromCache,
  warmUrls,
} from '../src/lib/service-worker/shell-cache';

const ORIGIN = 'https://pesly.test';

function response(overrides: {
  status?: number;
  redirected?: boolean;
  type?: string;
  contentType?: string | null;
  url?: string;
}) {
  const contentType =
    overrides.contentType === undefined ? 'text/html; charset=utf-8' : overrides.contentType;
  return {
    status: overrides.status ?? 200,
    redirected: overrides.redirected ?? false,
    type: overrides.type ?? 'basic',
    url: overrides.url ?? `${ORIGIN}/es/movements/new`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
  };
}

describe('shouldServeFromCache', () => {
  it('serves a navigation from the cache, with no network attempt, while offline (FR-04)', () => {
    expect(shouldServeFromCache({ mode: 'navigate', method: 'GET', online: false })).toBe(true);
  });

  it('goes to the network first for a navigation while online (FR-04)', () => {
    expect(shouldServeFromCache({ mode: 'navigate', method: 'GET', online: true })).toBe(false);
  });

  it('never answers a write or a request that is not a navigation from this cache (FR-04)', () => {
    expect(shouldServeFromCache({ mode: 'navigate', method: 'POST', online: false })).toBe(false);
    expect(shouldServeFromCache({ mode: 'cors', method: 'GET', online: false })).toBe(false);
    expect(shouldServeFromCache({ mode: 'no-cors', method: 'GET', online: false })).toBe(false);
  });
});

describe('isCacheableDocument', () => {
  it('accepts a 200, non-redirected, same-origin HTML document (FR-04)', () => {
    expect(isCacheableDocument(response({}), ORIGIN)).toBe(true);
  });

  it('refuses a redirected, non-200 or non-HTML response as an invalid candidate (FR-04)', () => {
    expect(isCacheableDocument(response({ redirected: true }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ status: 404 }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ status: 500 }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ contentType: 'application/json' }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ contentType: null }), ORIGIN)).toBe(false);
  });

  it('refuses an opaque or cross-origin response as invalid, so the API origin is never stored (FR-04)', () => {
    expect(isCacheableDocument(response({ type: 'opaque' }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ type: 'cors' }), ORIGIN)).toBe(false);
    expect(isCacheableDocument(response({ url: 'https://api.pesly.test/movements' }), ORIGIN)).toBe(
      false,
    );
  });
});

describe('warmUrls and acceptedCacheUrls', () => {
  it('asks for the two screens the offline flow needs, in the locale of the user (FR-04)', () => {
    expect(warmUrls('es')).toEqual(['/es/movements', '/es/movements/new']);
    expect(warmUrls('en')).toEqual(['/en/movements', '/en/movements/new']);
  });

  it('keeps same-origin paths that start with a slash and drops duplicates (FR-04)', () => {
    expect(
      acceptedCacheUrls(['/es/movements', '/es/movements', '/es/movements/new'], ORIGIN),
    ).toEqual(['/es/movements', '/es/movements/new']);
  });

  it('refuses a cross-origin or non-path URL as invalid and fetches nothing for it (FR-04)', () => {
    const invalid = [
      'https://evil.test/x',
      '//evil.test/x',
      '/\\evil.test/x',
      'es/movements',
      'javascript:alert(1)',
      '',
      '  ',
      42,
      null,
      { url: '/es/movements' },
    ];
    expect(acceptedCacheUrls(invalid, ORIGIN)).toEqual([]);
  });

  it('refuses a message that is not a list, as invalid input (FR-04)', () => {
    expect(acceptedCacheUrls('/es/movements', ORIGIN)).toEqual([]);
    expect(acceptedCacheUrls(undefined, ORIGIN)).toEqual([]);
    expect(acceptedCacheUrls({ 0: '/es/movements' }, ORIGIN)).toEqual([]);
  });

  it('normalizes a path with dot segments instead of trusting it as written (FR-04)', () => {
    expect(acceptedCacheUrls(['/es/../en/movements'], ORIGIN)).toEqual(['/en/movements']);
  });
});

describe('isFrameworkFetch', () => {
  const rsc = `${ORIGIN}/es/accounts?_rsc=abc123`;

  it('recognizes a same-origin RSC read, which the worker answers without the network (NFR-02)', () => {
    expect(isFrameworkFetch({ method: 'GET', url: rsc, origin: ORIGIN })).toBe(true);
  });

  it('never matches a cross-origin request, the API above all', () => {
    expect(
      isFrameworkFetch({
        method: 'GET',
        url: 'https://api.pesly.test/accounts?_rsc=abc',
        origin: ORIGIN,
      }),
    ).toBe(false);
  });

  it('ignores writes and plain fetches without the RSC marker', () => {
    expect(isFrameworkFetch({ method: 'POST', url: rsc, origin: ORIGIN })).toBe(false);
    expect(isFrameworkFetch({ method: 'GET', url: `${ORIGIN}/es/accounts`, origin: ORIGIN })).toBe(
      false,
    );
  });

  it('rejects an invalid URL instead of throwing', () => {
    expect(isFrameworkFetch({ method: 'GET', url: 'not a url', origin: ORIGIN })).toBe(false);
  });
});
