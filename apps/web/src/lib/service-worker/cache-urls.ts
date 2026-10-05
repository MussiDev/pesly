import { acceptedCacheUrls, isCacheableDocument } from './shell-cache';

/** What the handler needs from the worker, injected so a test can run it without one. */
export interface CacheUrlsDependencies {
  /** The origin of the worker: only paths of this origin are ever fetched. */
  origin: string;
  fetch: (request: Request) => Promise<Response>;
  open: () => Promise<{ put(url: string, response: Response): Promise<void> }>;
}

/**
 * Fetches and stores the pages a `PESLY_CACHE_URLS` message asks for. The message comes from a page,
 * so it is parsed first; a URL that fails to load, redirects or is not HTML is skipped and the
 * others are still stored. Returns the paths that were stored.
 */
export async function cacheRequestedUrls(
  urls: unknown,
  deps: CacheUrlsDependencies,
): Promise<string[]> {
  const paths = acceptedCacheUrls(urls, deps.origin);
  if (paths.length === 0) return [];
  const cache = await deps.open();
  const cached: string[] = [];
  for (const path of paths) {
    try {
      const response = await deps.fetch(
        new Request(`${deps.origin}${path}`, { credentials: 'same-origin' }),
      );
      if (!isCacheableDocument(response, deps.origin)) continue;
      await cache.put(path, response);
      cached.push(path);
    } catch {
      // A page that cannot be fetched right now is simply not cached; the next sign-in asks again.
    }
  }
  return cached;
}
