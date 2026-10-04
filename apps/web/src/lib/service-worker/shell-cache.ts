/**
 * The decisions of the service worker, as pure functions over plain values: nothing here touches
 * `self`, `caches` or the network, so Vitest can run them without a worker.
 */

/** What a fetch event tells the worker about one request. */
export interface NavigationRequest {
  /** `Request.mode`: `navigate` for a page load. */
  mode: string;
  method: string;
  /** `navigator.onLine` as the worker sees it. */
  online: boolean;
}

/**
 * A page load while offline is answered from the cache with no network attempt at all (NFR-02);
 * online it goes to the network first and the cache is only the fallback. Writes and everything
 * that is not a navigation are never answered by this cache.
 */
export function shouldServeFromCache(request: NavigationRequest): boolean {
  return request.mode === 'navigate' && request.method === 'GET' && !request.online;
}

/**
 * Next.js prefetches the screens its links point to with `?_rsc=` fetches. Without a connection
 * those would fail for nothing: the worker answers them with an empty response, the prefetch is
 * dropped quietly, and a click falls back to a page load that the page cache can serve (NFR-02).
 * Only same-origin reads qualify; the API origin is never touched.
 */
export function isFrameworkFetch(request: {
  method: string;
  url: string;
  origin: string;
}): boolean {
  if (request.method !== 'GET') return false;
  try {
    const url = new URL(request.url);
    return url.origin === request.origin && url.searchParams.has('_rsc');
  } catch {
    return false;
  }
}

/** The parts of a `Response` the cache looks at. */
export interface DocumentResponse {
  status: number;
  redirected: boolean;
  type: string;
  url: string;
  headers: { get(name: string): string | null };
}

/**
 * Only a plain 200 HTML document of the web origin is stored. A redirect (a sign-in bounce) is never
 * kept under the URL that was asked for, and neither is an opaque or cross-origin response, so the
 * API origin can never end up in this cache.
 */
export function isCacheableDocument(response: DocumentResponse, origin: string): boolean {
  if (response.status !== 200 || response.redirected) return false;
  if (
    response.type === 'opaque' ||
    response.type === 'opaqueredirect' ||
    response.type === 'cors'
  ) {
    return false;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/html')) return false;
  try {
    return new URL(response.url).origin === origin;
  } catch {
    return false;
  }
}

/** The two screens the offline flow needs, cached after sign-in: the list and the entry screen. */
export function warmUrls(locale: string): string[] {
  return [`/${locale}/movements`, `/${locale}/movements/new`];
}

/**
 * The paths of a `CACHE_URLS` message that the worker will fetch. The message comes from a page, so
 * it is parsed rather than trusted: a list of strings, each a same-origin path that starts with one
 * slash. Anything else is dropped, and a path is normalized before it is used.
 */
export function acceptedCacheUrls(message: unknown, origin: string): string[] {
  if (!Array.isArray(message)) return [];
  const accepted: string[] = [];
  for (const entry of message as unknown[]) {
    if (typeof entry !== 'string' || !/^\/(?![/\\])\S*$/.test(entry)) continue;
    try {
      const url = new URL(entry, origin);
      if (url.origin !== origin) continue;
      const path = `${url.pathname}${url.search}`;
      if (!accepted.includes(path)) accepted.push(path);
    } catch {
      // A string that does not parse as a URL is not a path to cache.
    }
  }
  return accepted;
}
