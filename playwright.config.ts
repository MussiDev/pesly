import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
/** The service worker only exists in a production build; this runs the web app as CI does. */
const productionBuild = isCI || process.env.E2E_PRODUCTION_BUILD === '1';
const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

/** Dedicated database for end-to-end runs; never the development database. */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_e2e';

/**
 * The fake Google OpenID Connect server (apps/api/test/fake-google-oidc-server.ts). It listens on
 * 127.0.0.1, another site than the web app and API on localhost, so its consent page starts a
 * cross-site navigation back to the callback, as Google does.
 */
const FAKE_GOOGLE_ORIGIN = 'http://127.0.0.1:4100';
const FAKE_GOOGLE_CLIENT = {
  GOOGLE_CLIENT_ID: 'e2e-google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
};

/** The email worker's environment: only the settings it reads, as in production. */
const WORKER_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  WEB_BASE_URL: WEB_URL,
  EMAIL_PROVIDER: 'mailpit',
  // Never reach dolarapi.com from e2e.
  RATE_PROVIDER: 'fake',
  // Never reach CoinGecko from e2e.
  PRICE_PROVIDER: 'fake',
};

/** The e2e API's environment: the worker's database and email settings plus its own. */
const API_ENV = {
  ...WORKER_ENV,
  E2E_DATABASE_URL,
  JWT_SECRET: 'e2e-only-secret-that-is-at-least-thirty-two-bytes',
  WEB_ORIGIN: WEB_URL,
  API_ORIGIN: API_URL,
  BREACH_CHECKER: 'fake',
  // Base64 of 32 bytes, for e2e runs only: seals the TOTP secrets enrolled by the 2FA flows.
  TOTP_ENCRYPTION_KEY: 'ZTJlLW9ubHktdG90cC1lbmNyeXB0aW9uLWtleS0zMmI=',
  ...FAKE_GOOGLE_CLIENT,
  GOOGLE_AUTHORIZATION_URL: `${FAKE_GOOGLE_ORIGIN}/authorize`,
  GOOGLE_TOKEN_URL: `${FAKE_GOOGLE_ORIGIN}/token`,
  GOOGLE_JWKS_URL: `${FAKE_GOOGLE_ORIGIN}/jwks`,
  GOOGLE_ISSUER: FAKE_GOOGLE_ORIGIN,
};

export default defineConfig({
  testDir: './apps/web/e2e',
  // End-to-end flows share one database and one Mailpit inbox.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Stands in for Google, so no e2e test ever calls it.
      command: 'pnpm --filter @pesly/api exec tsx test/fake-google-oidc-server.ts',
      url: `${FAKE_GOOGLE_ORIGIN}/jwks`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...FAKE_GOOGLE_CLIENT,
        FAKE_GOOGLE_PORT: '4100',
        FAKE_GOOGLE_REDIRECT_URI: `${API_URL}/auth/google/callback`,
      },
    },
    {
      // Playwright starts webServers before globalSetup, so the e2e database is created and
      // migrated as part of the API command, before the API boots.
      command:
        'pnpm --filter @pesly/api exec tsx test/e2e-database.ts && pnpm --filter @pesly/api start',
      url: `${API_URL}/health`,
      // Never reuse a running API: it could be pointed at another database.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: '4000', ...API_ENV },
    },
    {
      // Delivers the outbox to Mailpit; without it no verification or reset email is ever sent.
      // Started after the API command, which creates and migrates the e2e database.
      command: 'pnpm --filter @pesly/api worker',
      wait: { stdout: /email worker started/ },
      reuseExistingServer: false,
      timeout: 60_000,
      // The recurring, notices and automatic debit passes run every 5 s instead of every minute,
      // so a flow waits seconds for the worker, not minutes.
      env: { ...WORKER_ENV, RECURRING_JOB_INTERVAL_SECONDS: '5' },
    },
    {
      command: productionBuild
        ? 'pnpm --filter @pesly/web build && pnpm --filter @pesly/web start'
        : 'pnpm --filter @pesly/web dev',
      url: `${WEB_URL}/es`,
      // A dev server cannot stand in for the production build the offline flows need.
      reuseExistingServer: !productionBuild,
      timeout: 180_000,
      env: {
        API_ORIGIN: API_URL,
      },
    },
  ],
});
