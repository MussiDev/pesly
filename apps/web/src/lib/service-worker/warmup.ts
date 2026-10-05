import { warmUrls } from './shell-cache';

/** The message the page sends and `src/app/sw.ts` listens for. */
export const CACHE_URLS_MESSAGE = 'PESLY_CACHE_URLS';

/**
 * Asks the active service worker to cache the list and the entry screen of `locale`, so both open
 * without a network. `false` when there is no worker to ask (an unsupported browser, a registration
 * that failed, a worker that is not active yet): the app works the same, only offline start waits
 * for a later visit.
 */
export async function requestShellWarmup(locale: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active === null) return false;
    registration.active.postMessage({ type: CACHE_URLS_MESSAGE, urls: warmUrls(locale) });
    return true;
  } catch {
    return false;
  }
}
