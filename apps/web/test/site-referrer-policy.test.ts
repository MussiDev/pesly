import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

async function siteHeaders(): Promise<
  { source: string; headers: { key: string; value: string }[] }[]
> {
  const { default: nextConfig } = await import('../next.config');
  const resolved = await nextConfig.headers?.();
  if (resolved === undefined) throw new Error('next.config.ts defines no headers');
  return resolved;
}

describe('site-wide referrer policy on the movements screen (R-10)', () => {
  it('next.config applies strict-origin-when-cross-origin to every path, including /es/movements', async () => {
    const entry = (await siteHeaders()).find((item) => item.source === '/:path*');
    expect(entry?.headers).toContainEqual({
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    });
  });

  it.each(['/es/movements', '/en/movements'])(
    'the proxy does not override that policy for %s, even with filters in the URL',
    async (path) => {
      vi.resetModules();
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_ORIGIN', 'https://api.argent.test');
      const { default: proxy } = await import('../src/proxy');

      const response = proxy(new NextRequest(`https://argent.test${path}?tag=viaje`));

      expect(response.headers.get('Referrer-Policy')).toBeNull();
      vi.unstubAllEnvs();
    },
  );
});
