export interface CspOptions {
  nonce: string;
  apiOrigin: string | undefined;
  isDev: boolean;
}

/**
 * CSP without inline scripts (R-20): Next.js' own bootstrap scripts run through a per-request
 * nonce plus 'strict-dynamic'. Inline `style` attributes (used by React and Radix for positioning)
 * are allowed; `<style>` elements still need the nonce.
 */
export function contentSecurityPolicy({ nonce, apiOrigin, isDev }: CspOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' ${isDev ? `'unsafe-inline'` : `'nonce-${nonce}'`}`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    `object-src 'none'`,
    // `strict-dynamic` makes `script-src` ignore 'self' for scripts, so a worker needs its own say.
    `worker-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];
  return directives.join('; ');
}
