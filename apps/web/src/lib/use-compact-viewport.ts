'use client';

import { useSyncExternalStore } from 'react';

/** The side menu takes over from 1024 px (the `desk` breakpoint); below it the screen is compact. */
const COMPACT_QUERY = '(max-width: 63.9975rem)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(COMPACT_QUERY).matches;
}

/** Whether the viewport is below the desk breakpoint; `false` on the server and without matchMedia. */
export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
