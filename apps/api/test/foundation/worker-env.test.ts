import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '../../src/shared/config/env';

/**
 * The seven settings without a default that the worker reads, as a production service sets them.
 * RATE_PROVIDER and DOLARAPI_BASE_URL are optional with production-safe defaults, so they are absent.
 */
const WORKER_PRODUCTION = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://worker:worker-db-password@db.internal:5432/app',
  WEB_BASE_URL: 'https://app.example.com',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_worker_test_key_0123456789',
  EMAIL_FROM: 'App <no-reply@example.com>',
};

function parseProduction(overrides: Record<string, string | undefined>) {
  return () => parseWorkerEnv({ ...WORKER_PRODUCTION, ...overrides });
}

const COINGECKO_DEFAULT = 'https://api.coingecko.com/api/v3';
const SECRET_KEY = 'CG-worker-secret-key-0123456789';

describe('worker environment', () => {
  it('accepts production with only its seven settings, without JWT_SECRET or Google settings', () => {
    const env = parseWorkerEnv(WORKER_PRODUCTION);

    expect(env.NODE_ENV).toBe('production');
    expect(env.WEB_BASE_URL).toBe('https://app.example.com');
    expect(env.EMAIL_FROM).toBe('App <no-reply@example.com>');
    expect(env).not.toHaveProperty('JWT_SECRET');
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_ID');
  });

  it('accepts the exchange rate settings with defaults, and no API-only setting', () => {
    const env = parseWorkerEnv(WORKER_PRODUCTION);

    expect(env.RATE_PROVIDER).toBe('dolarapi');
    expect(env.DOLARAPI_BASE_URL).toBe('https://dolarapi.com');
    expect(env).not.toHaveProperty('TOTP_ENCRYPTION_KEY');

    const local = parseWorkerEnv({
      ...WORKER_PRODUCTION,
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'console',
      RATE_PROVIDER: 'fake',
      DOLARAPI_BASE_URL: 'http://127.0.0.1:4200',
    });
    expect(local.RATE_PROVIDER).toBe('fake');
    expect(local.DOLARAPI_BASE_URL).toBe('http://127.0.0.1:4200');
  });

  it('refuses fake and a changed base URL in production, naming the variable only', () => {
    expect(parseProduction({ RATE_PROVIDER: 'fake' })).toThrow(/RATE_PROVIDER/);
    const changed = parseProduction({ DOLARAPI_BASE_URL: 'https://evil.example.com' });
    expect(changed).toThrow(/DOLARAPI_BASE_URL/);
    expect(changed).not.toThrow(/evil\.example/);
  });

  it('invalid WEB_BASE_URL error: refuses http links in production', () => {
    expect(parseProduction({ WEB_BASE_URL: 'http://app.example.com' })).toThrow(/WEB_BASE_URL/);
  });

  it('invalid EMAIL_PROVIDER error: requires resend in production', () => {
    expect(parseProduction({ EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('missing DATABASE_URL error: names the variable without printing any value', () => {
    let message = '';
    try {
      parseWorkerEnv({ ...WORKER_PRODUCTION, DATABASE_URL: undefined });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_URL/);
    for (const value of Object.values(WORKER_PRODUCTION)) {
      expect(message).not.toContain(value);
    }
  });

  it('missing Resend settings error: names RESEND_API_KEY and EMAIL_FROM', () => {
    expect(parseProduction({ RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
    expect(parseProduction({ EMAIL_FROM: undefined })).toThrow(/EMAIL_FROM/);
  });

  it('refuses resend outside production', () => {
    expect(parseProduction({ NODE_ENV: 'development' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('gives console and mailpit a local sender when EMAIL_FROM is unset', () => {
    const env = parseWorkerEnv({
      DATABASE_URL: WORKER_PRODUCTION.DATABASE_URL,
      WEB_BASE_URL: 'http://localhost:3000',
      EMAIL_PROVIDER: 'mailpit',
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.EMAIL_FROM).toMatch(/no-reply@/);
  });

  it('defaults PRICE_PROVIDER to coingecko, the base URL to the public API and the key to unset', () => {
    const env = parseWorkerEnv(WORKER_PRODUCTION);

    expect(env.PRICE_PROVIDER).toBe('coingecko');
    expect(env.COINGECKO_BASE_URL).toBe(COINGECKO_DEFAULT);
    expect(env.COINGECKO_API_KEY).toBeUndefined();
  });

  it('accepts a missing, empty or blank key in production so the worker starts without one', () => {
    for (const COINGECKO_API_KEY of [undefined, '', '   ']) {
      const env = parseProduction({ COINGECKO_API_KEY })();
      expect(env.COINGECKO_API_KEY).toBeUndefined();
    }
  });

  it('trims whitespace around a pasted key and still rejects interior whitespace or non-ASCII', () => {
    for (const padded of [`${SECRET_KEY}\n`, ` ${SECRET_KEY} `, `\t${SECRET_KEY}\r\n`]) {
      expect(parseProduction({ COINGECKO_API_KEY: padded })().COINGECKO_API_KEY).toBe(SECRET_KEY);
    }
    for (const bad of ['abc def-secret', 'clave-\u00f1andu-secret']) {
      let message = '';
      try {
        parseProduction({ COINGECKO_API_KEY: ` ${bad}\n` })();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('COINGECKO_API_KEY');
      expect(message).not.toContain(bad);
    }
  });

  it('keeps a configured key and accepts fake and a local base URL outside production', () => {
    expect(parseProduction({ COINGECKO_API_KEY: SECRET_KEY })().COINGECKO_API_KEY).toBe(SECRET_KEY);

    const local = parseWorkerEnv({
      ...WORKER_PRODUCTION,
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'console',
      PRICE_PROVIDER: 'fake',
      COINGECKO_BASE_URL: 'http://127.0.0.1:4300',
    });
    expect(local.PRICE_PROVIDER).toBe('fake');
    expect(local.COINGECKO_BASE_URL).toBe('http://127.0.0.1:4300');
  });

  it('refuses fake and a changed base URL in production, naming the variable only', () => {
    expect(parseProduction({ PRICE_PROVIDER: 'fake' })).toThrow(/PRICE_PROVIDER/);
    const changed = parseProduction({ COINGECKO_BASE_URL: 'https://evil.example.com' });
    expect(changed).toThrow(/COINGECKO_BASE_URL/);
    expect(changed).not.toThrow(/evil\.example/);
  });

  it('refuses an invalid price provider, base URL or key by name without printing the value', () => {
    for (const [name, value] of [
      ['PRICE_PROVIDER', 'unknown-provider-value'],
      ['COINGECKO_BASE_URL', 'not-a-url-value'],
      ['COINGECKO_API_KEY', 'key with spaces'],
    ] as const) {
      let message = '';
      try {
        parseProduction({ NODE_ENV: 'development', EMAIL_PROVIDER: 'console', [name]: value })();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).not.toContain(value);
    }
  });
});
