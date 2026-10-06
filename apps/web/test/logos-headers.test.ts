import { describe, expect, it } from 'vitest';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const { default: nextConfig } = await import('../next.config');
  const resolved = await nextConfig.headers?.();
  if (resolved === undefined) throw new Error('next.config.ts defines no headers');
  return resolved;
}

/** A rule only counts when it denies by default and sandboxes the document. */
function sandboxes(rule: HeaderRule | undefined): boolean {
  const policy = rule?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
  return policy !== undefined && /sandbox/.test(policy) && /default-src 'none'/.test(policy);
}

describe('logo files opened as a document (AC-26, R-01)', () => {
  it('sends a sandboxing Content-Security-Policy for /logos/:path*', async () => {
    const rule = (await rules()).find((item) => item.source === '/logos/:path*');

    expect(sandboxes(rule)).toBe(true);
  });

  it('keeps the site-wide security headers on every path', async () => {
    const site = (await rules()).find((item) => item.source === '/:path*');

    expect(site?.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
  });

  it('error: a missing rule, or one without sandbox or default-src none, is reported', () => {
    expect(sandboxes(undefined)).toBe(false);
    expect(
      sandboxes({
        source: '/logos/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }],
      }),
    ).toBe(false);
    expect(
      sandboxes({
        source: '/logos/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'sandbox' }],
      }),
    ).toBe(false);
    expect(
      sandboxes({
        source: '/logos/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" }],
      }),
    ).toBe(true);
  });
});
