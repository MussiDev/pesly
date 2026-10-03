import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import('../src/proxy')).default;
}

function nonceOf(csp: string | null): string | undefined {
  return /'nonce-([^']+)'/.exec(csp ?? '')?.[1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('fails at startup in production without API_ORIGIN', async () => {
    await expect(loadProxy({ NODE_ENV: 'production', API_ORIGIN: '' })).rejects.toThrow(
      /API_ORIGIN/,
    );
  });

  it('sends a fresh CSP nonce to Next.js and the browser, allowing the API origin', async () => {
    const proxy = await loadProxy({
      NODE_ENV: 'production',
      API_ORIGIN: 'https://api.argent.test',
    });
    const request = new NextRequest('https://argent.test/es/sign-in');

    const response = proxy(request);

    const csp = response.headers.get('Content-Security-Policy');
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(request.headers.get('x-nonce')).toBe(nonce);
    expect(request.headers.get('Content-Security-Policy')).toBe(csp);
    expect(csp).toContain(`connect-src 'self' https://api.argent.test`);
    expect(csp).not.toContain('unsafe-eval');

    const other = proxy(new NextRequest('https://argent.test/es/sign-in'));
    expect(nonceOf(other.headers.get('Content-Security-Policy'))).not.toBe(nonce);
  });

  it('forwards x-nonce and the CSP to the request the layout reads, through next-intl', async () => {
    const proxy = await loadProxy({
      NODE_ENV: 'production',
      API_ORIGIN: 'https://api.argent.test',
    });

    const response = proxy(new NextRequest('https://argent.test/es/sign-in'));

    const csp = response.headers.get('Content-Security-Policy');
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    // NextResponse.next({ request: { headers } }) is how next-intl hands request headers on.
    const overridden = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
    expect(overridden).toContain('x-nonce');
    expect(overridden).toContain('content-security-policy');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('relaxes the CSP for the development server only', async () => {
    const proxy = await loadProxy({ NODE_ENV: 'development', API_ORIGIN: '' });

    const response = proxy(new NextRequest('http://localhost:3000/es'));

    expect(response.headers.get('Content-Security-Policy')).toContain(`'unsafe-eval'`);
    expect(response.headers.get('Content-Security-Policy')).toContain(
      `connect-src 'self' http://localhost:4000`,
    );
  });

  it('redirects a path without locale to the default locale', async () => {
    const proxy = await loadProxy({
      NODE_ENV: 'production',
      API_ORIGIN: 'https://api.argent.test',
    });

    const response = proxy(new NextRequest('https://argent.test/sign-in'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://argent.test/es/sign-in');
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it.each(['/es/verify-email', '/en/reset-password'])(
    'keeps the token of %s out of the Referer header',
    async (path) => {
      const proxy = await loadProxy({
        NODE_ENV: 'production',
        API_ORIGIN: 'https://api.argent.test',
      });

      const response = proxy(new NextRequest(`https://argent.test${path}?token=abc`));

      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    },
  );

  it('leaves the site-wide referrer policy on other pages', async () => {
    const proxy = await loadProxy({
      NODE_ENV: 'production',
      API_ORIGIN: 'https://api.argent.test',
    });

    const response = proxy(new NextRequest('https://argent.test/es/sign-in'));

    expect(response.headers.get('Referrer-Policy')).toBeNull();
  });
});
