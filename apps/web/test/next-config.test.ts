import type { NextConfig } from 'next';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

async function headerRules() {
  const config: NextConfig = nextConfig;
  return (await config.headers?.()) ?? [];
}

describe('next.config headers', () => {
  it('lets /serwist/sw.js control the whole origin and revalidates it on every load (FR-04)', async () => {
    const rules = await headerRules();
    const worker = rules.find((rule) => rule.source === '/serwist/:path*');

    expect(worker?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Service-Worker-Allowed', value: '/' },
        { key: 'Cache-Control', value: 'no-cache' },
      ]),
    );
  });

  it('keeps the security headers on every path (FR-04)', async () => {
    const rules = await headerRules();
    const everywhere = rules.find((rule) => rule.source === '/:path*');

    expect(everywhere?.headers.map((header) => header.key)).toEqual(
      expect.arrayContaining(['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy']),
    );
  });

  it('does not widen the worker scope for any other path (FR-04)', async () => {
    const rules = await headerRules();
    const widened = rules.filter((rule) =>
      rule.headers.some((header) => header.key === 'Service-Worker-Allowed'),
    );

    expect(widened.map((rule) => rule.source)).toEqual(['/serwist/:path*']);
  });
});
