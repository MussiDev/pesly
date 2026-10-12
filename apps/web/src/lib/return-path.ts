/**
 * The only paths a sign-in may send the user back to: the report routes. An allow-list of exact
 * pathnames, so no absolute URL, protocol-relative host, backslash or traversal can pass.
 */
const RETURN_PATHS: readonly string[] = [
  '/reports',
  '/reports/categories',
  '/reports/income-expenses',
  '/reports/net-worth',
];

/** The value when it is exactly one of the allowed paths, otherwise `undefined`. */
export function safeReturnPath(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return RETURN_PATHS.includes(value) ? value : undefined;
}

/** The sign-in address for an expired session; only an allowed path travels with it. */
export function signInHref(currentPath: string): string {
  const next = safeReturnPath(currentPath);
  return next === undefined ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
}
