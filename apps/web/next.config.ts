import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Static security headers. The Content-Security-Policy needs a per-request nonce so Next.js can
// run its own scripts without allowing inline scripts; it is set in `src/proxy.ts`.
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// The proxy, and the per-request policy it sets, skips every path that contains a dot, so a logo
// opened directly as a document would get none. This one allows no source and sandboxes the
// document, so an SVG can never run a script in the app's origin.
const logoHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The repository keeps its own AGENTS.md; do not let `next dev` generate one inside apps/web.
  agentRules: false,
  transpilePackages: ['@pesly/shared'],
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // The worker script lives under /serwist/ but must control the whole origin, and the browser
      // must revalidate it on every load so a new version is noticed.
      {
        source: '/serwist/:path*',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
      { source: '/logos/:path*', headers: logoHeaders },
    ]);
  },
};

export default withSerwist(withNextIntl(nextConfig));
