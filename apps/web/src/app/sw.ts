/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';
import { cacheRequestedUrls } from '../lib/service-worker/cache-urls';
import { CACHE_URLS_MESSAGE } from '../lib/service-worker/warmup';
import {
  isCacheableDocument,
  isFrameworkFetch,
  shouldServeFromCache,
} from '../lib/service-worker/shell-cache';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Pages of the web origin that were visited online: the only thing cached besides the build assets. */
const PAGES_CACHE = 'pesly-pages-v1';

// Precaches the hashed build assets. No runtime caching rule on purpose: Serwist's default list
// also stores cross-origin answers, and the API origin (cookies, financial data) must never be
// kept here. `skipWaiting` is off: a new worker waits and takes over at the next start.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [],
});

async function openPages(): Promise<Cache> {
  return caches.open(PAGES_CACHE);
}

async function handleNavigation(request: Request): Promise<Response> {
  const cache = await openPages();
  const online = self.navigator.onLine;
  if (shouldServeFromCache({ mode: request.mode, method: request.method, online })) {
    // Offline: the cached page, with no network attempt at all.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (isCacheableDocument(response, self.location.origin)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Online in name only (a dropped connection): fall back to the last page seen online.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Prefetches of the framework are dropped without a failed request when there is no connection,
  // whether the browser reports it or the fetch only finds out by failing.
  if (
    isFrameworkFetch({ method: request.method, url: request.url, origin: self.location.origin })
  ) {
    const empty = () => new Response(null, { status: 204 });
    event.respondWith(self.navigator.onLine ? fetch(request).catch(empty) : empty());
    return;
  }
  // Only page loads of this origin: scripts and styles come from the precache, and every request
  // to another origin (the API above all) is left alone.
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(handleNavigation(request));
});

self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return;
  const message = data as { type?: unknown; urls?: unknown };
  if (message.type !== CACHE_URLS_MESSAGE) return;
  event.waitUntil(
    cacheRequestedUrls(message.urls, {
      origin: self.location.origin,
      fetch: (request) => fetch(request),
      open: openPages,
    }),
  );
});

serwist.addEventListeners();
