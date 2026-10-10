import { parseEnv, type Env } from '../../src/shared/config/env';
import { REQUIRED_REQUESTED_WITH } from '../../src/shared/http/origin-guard';
import { testDatabaseUrl } from './test-database';

export const WEB_ORIGIN = 'http://localhost:3000';

/** Headers a browser on WEB_ORIGIN sends with state-changing requests. */
export const trustedHeaders = {
  Origin: WEB_ORIGIN,
  'X-Requested-With': REQUIRED_REQUESTED_WITH,
} as const;

export const PRODUCTION_WEB_ORIGIN = 'https://app.argent.test';

/** Base64 of 32 bytes; only for tests. */
export const TEST_TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x5a).toString('base64');

/** Overrides that satisfy every production rule of the environment schema. */
export const productionOverrides: Record<string, string> = {
  NODE_ENV: 'production',
  WEB_ORIGIN: PRODUCTION_WEB_ORIGIN,
  API_ORIGIN: 'https://api.argent.test',
  WEB_BASE_URL: PRODUCTION_WEB_ORIGIN,
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'Pesly <no-reply@pesly.test>',
  BREACH_CHECKER: 'hibp',
  TRUST_PROXY: '1',
  GOOGLE_CLIENT_ID: 'argent-test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-test-client-secret',
  TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY,
  // The test source defaults to the fake provider, which production refuses.
  RATE_PROVIDER: 'dolarapi',
  PRICE_PROVIDER: 'coingecko',
};

export function testEnvSource(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
    WEB_ORIGIN,
    API_ORIGIN: 'http://localhost:4000',
    WEB_BASE_URL: WEB_ORIGIN,
    EMAIL_PROVIDER: 'console',
    BREACH_CHECKER: 'fake',
    TRUST_PROXY: '0',
    LOG_LEVEL: 'silent',
    RATE_PROVIDER: 'fake',
    PRICE_PROVIDER: 'fake',
    RECURRING_JOB_INTERVAL_SECONDS: '60',
    TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY,
    ...overrides,
  };
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv(testEnvSource(overrides));
}

export function productionEnv(overrides: Record<string, string> = {}): Env {
  return testEnv({ ...productionOverrides, ...overrides });
}
