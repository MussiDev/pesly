export type GroupLinkKind = 'join' | 'claim';

/**
 * The shareable link for a token the API returned. The token goes in the fragment only: a fragment
 * is never sent to a server or written to a log, and the target page clears it at once.
 */
export function buildGroupLink(
  kind: GroupLinkKind,
  token: string,
  origin: string,
  locale: string,
): string {
  return `${origin}/${locale}/groups/${kind}#token=${encodeURIComponent(token)}`;
}
