import { defineRailway, github, postgres, preserve, service } from 'railway/iac';

/** The partial owns only these services; the rest of the Railway project is left untouched. */
export const partial = 'pesly';

const source = github('MussiDev/pesly', { branch: 'main' });

// Railway stores its defaults (ON_FAILURE, 10 retries) as null, and the plan reports a declared
// default as a change forever. The type is left at Railway's ON_FAILURE default; the retries go
// below it, which keeps them explicit and costs fewer restarts in a crash loop.
const restart = { restartPolicyMaxRetries: 5 } as const;

// Railway stores watch patterns rooted at the repository, with a leading slash.
const apiWatchPatterns = ['/apps/api/**', '/packages/shared/**', '/pnpm-lock.yaml'];

const WEB_ORIGIN = 'https://pesly.com.ar';

// Values in production today; secrets keep the value Railway already holds and never live here.
const shared = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  WEB_BASE_URL: WEB_ORIGIN,
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'Pesly <no-reply@pesly.com.ar>',
} as const;

const API_ORIGIN = 'https://api.pesly.com.ar';

export default defineRailway((_ctx, project) => {
  const db = postgres('argent-postgres');

  const api = service('argent-api', {
    // Deploys wait for the GitHub checks (CI) to pass.
    source: github('MussiDev/pesly', { branch: 'main', checkSuites: true }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter ./apps/api --fail-if-no-match build',
      watchPatterns: apiWatchPatterns,
    },
    start: 'node --max-old-space-size=320 apps/api/dist/server.js',
    preDeploy: ['node apps/api/dist/shared/db/migrate.js'],
    deploy: {
      ...restart,
      limitOverride: { containers: { cpu: 2, memoryBytes: 2_000_000_000 } },
    },
    env: {
      ...shared,
      WEB_ORIGIN,
      API_ORIGIN,
      BREACH_CHECKER: 'hibp',
      TRUST_PROXY: '1',
      DATABASE_URL: db.env.DATABASE_URL,
      JWT_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      TOTP_ENCRYPTION_KEY: preserve(),
    },
  });

  // Only the settings parseWorkerEnv reads (FIX-003).
  const worker = service('argent-worker', {
    source,
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter ./apps/api --fail-if-no-match build',
      watchPatterns: apiWatchPatterns,
    },
    start: 'node --max-old-space-size=192 apps/api/dist/worker.js',
    // The heap cap bounds only V8; the container limit bounds the rest of the process (FIX-005).
    deploy: { ...restart, limitOverride: { containers: { cpu: 1, memoryBytes: 512_000_000 } } },
    // Shared settings follow the API's values instead of repeating them.
    env: {
      NODE_ENV: shared.NODE_ENV,
      LOG_LEVEL: shared.LOG_LEVEL,
      EMAIL_PROVIDER: shared.EMAIL_PROVIDER,
      WEB_BASE_URL: api.env.WEB_BASE_URL,
      EMAIL_FROM: api.env.EMAIL_FROM,
      DATABASE_URL: db.env.DATABASE_URL,
      RESEND_API_KEY: preserve(),
      // Optional: without it the price job runs on CoinGecko's public limits (DISC-001-07b).
      COINGECKO_API_KEY: preserve(),
    },
  });

  // Started with node directly, with no pnpm parent process (FIX-002).
  const web = service('argent-web', {
    source,
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter ./apps/web --fail-if-no-match build',
      watchPatterns: ['/apps/web/**', '/packages/shared/**', '/pnpm-lock.yaml'],
    },
    start: 'node --max-old-space-size=320 apps/web/node_modules/next/dist/bin/next start apps/web',
    deploy: { ...restart, limitOverride: { containers: { cpu: 1, memoryBytes: 1_000_000_000 } } },
    env: {
      NODE_ENV: 'production',
      API_ORIGIN: api.env.API_ORIGIN,
    },
  });

  return project('pesly', { resources: [db, api, worker, web] });
});
