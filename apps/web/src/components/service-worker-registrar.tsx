'use client';

import { useEffect } from 'react';

/** Served by `src/app/serwist/[path]/route.ts`. */
export const SERVICE_WORKER_URL = '/serwist/sw.js';

/**
 * Registers the service worker with the whole origin as its scope (the route sends
 * `Service-Worker-Allowed: /`). It renders nothing, runs only in a production build by default, and
 * never lets a failed registration reach the user: the app works online without a worker.
 */
export function ServiceWorkerRegistrar({
  enabled = process.env.NODE_ENV === 'production',
}: {
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }).catch(() => {
      // A browser or a policy that refuses the worker only costs the offline start.
    });
  }, [enabled]);

  return null;
}
