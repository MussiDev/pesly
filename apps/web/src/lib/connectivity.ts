'use client';

import { useSyncExternalStore } from 'react';

/** `true` only when the browser says it has no connection; outside a browser it is never offline. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Follows the `online` and `offline` events; the server render always assumes a connection. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !isOffline(),
    () => true,
  );
}
