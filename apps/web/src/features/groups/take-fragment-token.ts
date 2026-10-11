/**
 * Reads the one-time token of a group link (`#token=...`) and removes it from the address bar.
 * The token travels in the fragment so it never reaches a server or a log; `replaceState` (never
 * `pushState`) leaves no history entry that keeps it.
 */
export function takeFragmentToken(): string | null {
  const { hash, pathname, search } = window.location;
  const token = new URLSearchParams(hash.slice(1)).get('token');
  if (token !== null) window.history.replaceState(null, '', `${pathname}${search}`);
  return token;
}
