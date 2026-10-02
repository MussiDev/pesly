import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/shared/config/env';
import { productionOverrides, testEnvSource } from '../helpers/test-env';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';

/** Endpoints of a local OIDC server, as the integration and e2e runs configure them. */
const FAKE_GOOGLE: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'local-client',
  GOOGLE_CLIENT_SECRET: 'local-secret',
  GOOGLE_AUTHORIZATION_URL: 'http://127.0.0.1:4100/authorize',
  GOOGLE_TOKEN_URL: 'http://127.0.0.1:4100/token',
  GOOGLE_JWKS_URL: 'http://127.0.0.1:4100/jwks',
  GOOGLE_ISSUER: 'http://127.0.0.1:4100',
};

function parseProduction(overrides: Record<string, string>) {
  return () => parseEnv(testEnvSource({ ...productionOverrides, ...overrides }));
}

describe('environment production rules', () => {
  it('accepts a production environment that satisfies every rule', () => {
    const env = parseEnv(testEnvSource(productionOverrides));

    expect(env.NODE_ENV).toBe('production');
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('keeps development and test permissive (console email, fake breach checker, http, no proxy)', () => {
    expect(() => parseEnv(testEnvSource())).not.toThrow();
  });

  it('requires EMAIL_PROVIDER=resend in production', () => {
    expect(parseProduction({ EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER/);
    expect(parseProduction({ EMAIL_PROVIDER: 'mailpit' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('requires BREACH_CHECKER=hibp in production', () => {
    expect(parseProduction({ BREACH_CHECKER: 'fake' })).toThrow(/BREACH_CHECKER/);
  });

  it.each(['WEB_ORIGIN', 'API_ORIGIN', 'WEB_BASE_URL'])(
    'requires an https: %s in production',
    (name) => {
      expect(parseProduction({ [name]: 'http://argent.test' })).toThrow(new RegExp(name));
    },
  );

  it('requires TRUST_PROXY >= 1 in production', () => {
    expect(parseProduction({ TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
  });

  it('rejects the placeholder JWT_SECRET from .env.example in production', () => {
    expect(
      parseProduction({ JWT_SECRET: 'change-me-to-a-long-random-secret-of-at-least-32-bytes' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('allows the placeholder JWT_SECRET outside production', () => {
    expect(() =>
      parseEnv(
        testEnvSource({ JWT_SECRET: 'change-me-to-a-long-random-secret-of-at-least-32-bytes' }),
      ),
    ).not.toThrow();
  });

  it('requires EMAIL_PROVIDER to be set explicitly (no default)', () => {
    const source = testEnvSource();
    delete source.EMAIL_PROVIDER;
    expect(() => parseEnv(source)).toThrow(/EMAIL_PROVIDER/);
  });

  it('requires EMAIL_FROM when EMAIL_PROVIDER=resend', () => {
    const source = testEnvSource(productionOverrides);
    delete source.EMAIL_FROM;
    expect(() => parseEnv(source)).toThrow(/EMAIL_FROM/);
    expect(
      parseEnv(testEnvSource({ ...productionOverrides, EMAIL_FROM: 'Pesly <no-reply@pesly.app>' }))
        .EMAIL_FROM,
    ).toBe('Pesly <no-reply@pesly.app>');
  });

  it.each(['development', 'test'])(
    'refuses EMAIL_PROVIDER=resend with NODE_ENV=%s (the SDK prints raw provider errors there)',
    (nodeEnv) => {
      const resend = {
        NODE_ENV: nodeEnv,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'Pesly <no-reply@pesly.app>',
      };
      expect(() => parseEnv(testEnvSource(resend))).toThrow(
        /EMAIL_PROVIDER: resend requires NODE_ENV=production/,
      );
    },
  );

  it('gives console and mailpit a local sender when EMAIL_FROM is unset', () => {
    for (const provider of ['console', 'mailpit']) {
      expect(parseEnv(testEnvSource({ EMAIL_PROVIDER: provider })).EMAIL_FROM).toMatch(/@/);
    }
  });

  it('names Pesly in the local sender when EMAIL_FROM is unset', () => {
    expect(parseEnv(testEnvSource()).EMAIL_FROM).toBe('Pesly <no-reply@pesly.local>');
  });

  it('defaults the Google endpoints to Google and leaves the client unset outside production', () => {
    const env = parseEnv(testEnvSource());

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.GOOGLE_AUTHORIZATION_URL).toBe(GOOGLE_AUTHORIZATION_URL);
    expect(env.GOOGLE_TOKEN_URL).toBe(GOOGLE_TOKEN_URL);
    expect(env.GOOGLE_JWKS_URL).toBe(GOOGLE_JWKS_URL);
    expect(env.GOOGLE_ISSUER).toBe(GOOGLE_ISSUER);
  });

  it('treats empty GOOGLE_* values as unset (blank lines copied from .env.example)', () => {
    const env = parseEnv(
      testEnvSource({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_TOKEN_URL: '' }),
    );

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_TOKEN_URL).toBe(GOOGLE_TOKEN_URL);
  });

  it('accepts a local OIDC server for the Google endpoints outside production', () => {
    const env = parseEnv(testEnvSource(FAKE_GOOGLE));

    expect(env.GOOGLE_CLIENT_ID).toBe('local-client');
    expect(env.GOOGLE_TOKEN_URL).toBe('http://127.0.0.1:4100/token');
    expect(env.GOOGLE_ISSUER).toBe('http://127.0.0.1:4100');
  });

  it('requires GOOGLE_CLIENT_ID in production', () => {
    const source = { ...testEnvSource(productionOverrides), GOOGLE_CLIENT_ID: undefined };
    expect(() => parseEnv(source)).toThrow('GOOGLE_CLIENT_ID: required in production');
  });

  it('requires GOOGLE_CLIENT_SECRET in production, apart from the rule tying it to the client id', () => {
    const source = { ...testEnvSource(productionOverrides), GOOGLE_CLIENT_SECRET: undefined };
    expect(() => parseEnv(source)).toThrow('GOOGLE_CLIENT_SECRET: required in production');
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])(
    'does not let a whitespace-only %s satisfy production',
    (name) => {
      expect(parseProduction({ [name]: ' \t ' })).toThrow(new RegExp(`${name}: `));
    },
  );

  it('rejects a whitespace-only GOOGLE_CLIENT_ID outside production', () => {
    expect(() =>
      parseEnv(testEnvSource({ GOOGLE_CLIENT_ID: '   ', GOOGLE_CLIENT_SECRET: 'local-secret' })),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('trims GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', () => {
    const env = parseEnv(
      testEnvSource({ GOOGLE_CLIENT_ID: ' local-client ', GOOGLE_CLIENT_SECRET: 'local-secret\n' }),
    );

    expect(env.GOOGLE_CLIENT_ID).toBe('local-client');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('local-secret');
  });

  it('requires GOOGLE_CLIENT_SECRET whenever GOOGLE_CLIENT_ID is set', () => {
    expect(() => parseEnv(testEnvSource({ GOOGLE_CLIENT_ID: 'local-client' }))).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
  });

  it.each(['GOOGLE_AUTHORIZATION_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_JWKS_URL', 'GOOGLE_ISSUER'])(
    'rejects a non-Google %s in production',
    (name) => {
      expect(parseProduction({ [name]: FAKE_GOOGLE[name] ?? '' })).toThrow(new RegExp(name));
    },
  );

  it('rejects a Google endpoint that is not a URL', () => {
    expect(() => parseEnv(testEnvSource({ GOOGLE_JWKS_URL: 'not a url' }))).toThrow(
      /GOOGLE_JWKS_URL/,
    );
  });

  it('requires TOTP_ENCRYPTION_KEY in production (sad path)', () => {
    const source = { ...testEnvSource(productionOverrides), TOTP_ENCRYPTION_KEY: undefined };
    expect(() => parseEnv(source)).toThrow('TOTP_ENCRYPTION_KEY: required in production');
    expect(parseProduction({ TOTP_ENCRYPTION_KEY: '' })).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it.each([
    ['16 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['31 bytes', Buffer.alloc(31, 1).toString('base64')],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['32 bytes of base64url', Buffer.alloc(32, 0xfb).toString('base64url')],
    ['32 characters of text', 'a'.repeat(32)],
    ['base64 with a stray character', `${Buffer.alloc(32, 1).toString('base64')}!`],
  ])(
    'rejects a TOTP_ENCRYPTION_KEY of %s, in production and outside it (sad path)',
    (_label, key) => {
      expect(parseProduction({ TOTP_ENCRYPTION_KEY: key })).toThrow(/TOTP_ENCRYPTION_KEY/);
      expect(() => parseEnv(testEnvSource({ TOTP_ENCRYPTION_KEY: key }))).toThrow(
        /TOTP_ENCRYPTION_KEY/,
      );
    },
  );

  it('accepts a base64 TOTP_ENCRYPTION_KEY of exactly 32 bytes, and leaves it optional outside production', () => {
    const key = Buffer.alloc(32, 0xfb).toString('base64');

    expect(parseProduction({ TOTP_ENCRYPTION_KEY: key })().TOTP_ENCRYPTION_KEY).toBe(key);
    expect(
      parseEnv(testEnvSource({ TOTP_ENCRYPTION_KEY: '' })).TOTP_ENCRYPTION_KEY,
    ).toBeUndefined();
    const withoutKey = testEnvSource();
    delete withoutKey.TOTP_ENCRYPTION_KEY;
    expect(parseEnv(withoutKey).TOTP_ENCRYPTION_KEY).toBeUndefined();
  });
});

describe('exchange rate provider settings', () => {
  const DEFAULT_BASE_URL = 'https://dolarapi.com';

  it('defaults RATE_PROVIDER to dolarapi and DOLARAPI_BASE_URL to https://dolarapi.com', () => {
    const source = testEnvSource();
    delete source.RATE_PROVIDER;

    const env = parseEnv(source);

    expect(env.RATE_PROVIDER).toBe('dolarapi');
    expect(env.DOLARAPI_BASE_URL).toBe(DEFAULT_BASE_URL);
  });

  it('accepts fake outside production and a different base URL', () => {
    const env = parseEnv(
      testEnvSource({ RATE_PROVIDER: 'fake', DOLARAPI_BASE_URL: 'http://127.0.0.1:4200' }),
    );

    expect(env.RATE_PROVIDER).toBe('fake');
    expect(env.DOLARAPI_BASE_URL).toBe('http://127.0.0.1:4200');
  });

  it.each([
    ['RATE_PROVIDER', 'unknown-provider-value'],
    ['DOLARAPI_BASE_URL', 'not-a-url-value'],
  ])('rejects an invalid %s by name, without printing the value', (name, value) => {
    let message = '';
    try {
      parseEnv(testEnvSource({ [name]: value }));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain(name);
    expect(message).not.toContain(value);
  });

  it('rejects fake in production', () => {
    expect(() =>
      parseEnv(testEnvSource({ ...productionOverrides, RATE_PROVIDER: 'fake' })),
    ).toThrow('RATE_PROVIDER: must be dolarapi in production');
  });

  it('rejects a changed base URL in production without printing it', () => {
    const attempt = () =>
      parseEnv(
        testEnvSource({ ...productionOverrides, DOLARAPI_BASE_URL: 'https://evil.example.com' }),
      );

    expect(attempt).toThrow(
      'DOLARAPI_BASE_URL: must be the default dolarapi endpoint in production',
    );
    expect(attempt).not.toThrow(/evil\.example/);
  });

  it('accepts production with only the defaults', () => {
    const env = parseEnv(testEnvSource(productionOverrides));

    expect(env.RATE_PROVIDER).toBe('dolarapi');
    expect(env.DOLARAPI_BASE_URL).toBe(DEFAULT_BASE_URL);
  });
});

describe('crypto price provider settings', () => {
  const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3';

  it('defaults PRICE_PROVIDER to coingecko, the base URL to the public API and no key', () => {
    const source = testEnvSource();
    delete source.PRICE_PROVIDER;

    const env = parseEnv(source);

    expect(env.PRICE_PROVIDER).toBe('coingecko');
    expect(env.COINGECKO_BASE_URL).toBe(DEFAULT_BASE_URL);
    expect(env.COINGECKO_API_KEY).toBeUndefined();
  });

  it('accepts fake and a different base URL outside production', () => {
    const env = parseEnv(
      testEnvSource({ PRICE_PROVIDER: 'fake', COINGECKO_BASE_URL: 'http://127.0.0.1:4300' }),
    );

    expect(env.PRICE_PROVIDER).toBe('fake');
    expect(env.COINGECKO_BASE_URL).toBe('http://127.0.0.1:4300');
  });

  it.each([
    ['PRICE_PROVIDER', 'unknown-provider-value'],
    ['COINGECKO_BASE_URL', 'not-a-url-value'],
    ['COINGECKO_API_KEY', 'key with spaces'],
  ])('rejects an invalid %s by name, without printing the value', (name, value) => {
    let message = '';
    try {
      parseEnv(testEnvSource({ [name]: value }));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain(name);
    expect(message).not.toContain(value);
  });

  it('trims whitespace around a pasted key and rejects interior whitespace or non-ASCII', () => {
    for (const padded of ['demo-key-123\n', ' demo-key-123 ', '\tdemo-key-123\r\n']) {
      const env = parseEnv(testEnvSource({ ...productionOverrides, COINGECKO_API_KEY: padded }));
      expect(env.COINGECKO_API_KEY).toBe('demo-key-123');
    }
    for (const bad of ['abc def-secret', 'clave-\u00f1andu-secret']) {
      let message = '';
      try {
        parseEnv(testEnvSource({ COINGECKO_API_KEY: ` ${bad}\n` }));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('COINGECKO_API_KEY');
      expect(message).not.toContain(bad);
    }
  });

  it('rejects fake in production', () => {
    expect(() =>
      parseEnv(testEnvSource({ ...productionOverrides, PRICE_PROVIDER: 'fake' })),
    ).toThrow('PRICE_PROVIDER: must be coingecko in production');
  });

  it('rejects a changed base URL in production without printing it', () => {
    const attempt = () =>
      parseEnv(
        testEnvSource({ ...productionOverrides, COINGECKO_BASE_URL: 'https://evil.example.com' }),
      );

    expect(attempt).toThrow(
      'COINGECKO_BASE_URL: must be the default CoinGecko endpoint in production',
    );
    expect(attempt).not.toThrow(/evil\.example/);
  });

  it('accepts production with a missing or empty key and with only the defaults', () => {
    const missing = parseEnv(testEnvSource(productionOverrides));
    expect(missing.PRICE_PROVIDER).toBe('coingecko');
    expect(missing.COINGECKO_BASE_URL).toBe(DEFAULT_BASE_URL);
    expect(missing.COINGECKO_API_KEY).toBeUndefined();

    const empty = parseEnv(testEnvSource({ ...productionOverrides, COINGECKO_API_KEY: '' }));
    expect(empty.COINGECKO_API_KEY).toBeUndefined();
  });
});
