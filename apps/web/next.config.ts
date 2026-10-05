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
    ]);
  },
};

export default withSerwist(withNextIntl(nextConfig));
