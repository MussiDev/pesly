import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/lib/content-security-policy';

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((directive) => {
      const [name = '', ...values] = directive.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

describe('content security policy (R-20)', () => {
  const production = directives(
    contentSecurityPolicy({ nonce: 'abc123', apiOrigin: 'https://api.argent.test', isDev: false }),
  );

  it('allows scripts only through the nonce, never inline', () => {
    expect(production.get('script-src')).toBe(`'self' 'nonce-abc123' 'strict-dynamic'`);
  });

  it('allows inline style attributes but nonce-only style elements', () => {
    expect(production.get('style-src')).toBe(`'self' 'nonce-abc123'`);
    expect(production.get('style-src-attr')).toBe(`'unsafe-inline'`);
  });

  it('lets the web app call the API origin', () => {
    expect(production.get('connect-src')).toBe(`'self' https://api.argent.test`);
  });

  it('lets a worker load from the same origin only, in production and in development (FR-04)', () => {
    const development = directives(
      contentSecurityPolicy({ nonce: 'abc123', apiOrigin: 'http://localhost:4000', isDev: true }),
    );
    expect(production.get('worker-src')).toBe(`'self'`);
    expect(development.get('worker-src')).toBe(`'self'`);
  });

  it('keeps every earlier directive when the worker one is added (FR-04)', () => {
    for (const name of [
      'default-src',
      'script-src',
      'style-src',
      'style-src-attr',
      'img-src',
      'font-src',
      'connect-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'upgrade-insecure-requests',
    ]) {
      expect(production.has(name), name).toBe(true);
    }
  });

  it('forbids framing, plugins and base-uri changes', () => {
    expect(production.get('frame-ancestors')).toBe(`'none'`);
    expect(production.get('object-src')).toBe(`'none'`);
    expect(production.get('base-uri')).toBe(`'self'`);
  });
});
