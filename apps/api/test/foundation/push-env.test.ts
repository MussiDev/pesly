import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnv, parseWorkerEnv } from '../../src/shared/config/env';
import { productionOverrides, testEnvSource } from '../helpers/test-env';

/** A fixed pair, only for tests: private scalar and the raw public point, both base64url. */
const PRIVATE_KEY = '1uzs8qQlPbz2Em3SoJXwsdwyMW2VNc7DDhvb9jRoNH8';
const PUBLIC_KEY =
  'BIb54nj4rQhdyWAbVhqO8fnuXtV63GEWGtoFlOX9_N_MOKRx8p2uZBAmtlZQTxmI97il3n5xo37qQi_-k7_drfc';
const SUBJECT = 'mailto:ops@example.com';

const WORKER_PRODUCTION = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://worker:worker-db-password@db.internal:5432/app',
  WEB_BASE_URL: 'https://app.example.com',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_worker_test_key_0123456789',
  EMAIL_FROM: 'App <no-reply@example.com>',
  PUSH_PROVIDER: 'webpush',
  VAPID_PUBLIC_KEY: PUBLIC_KEY,
  VAPID_PRIVATE_KEY: PRIVATE_KEY,
  VAPID_SUBJECT: SUBJECT,
};

const workerProd = (overrides: Record<string, string | undefined> = {}) => () =>
  parseWorkerEnv({ ...WORKER_PRODUCTION, ...overrides });
const apiProd = (overrides: Record<string, string | undefined> = {}) => () =>
  parseEnv({
    ...testEnvSource({ ...productionOverrides, PUSH_PROVIDER: 'webpush' }),
    VAPID_PUBLIC_KEY: PUBLIC_KEY,
    ...overrides,
  });

const workerLocal = (overrides: Record<string, string | undefined> = {}) => () =>
  parseWorkerEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://x:y@localhost:5432/app',
    WEB_BASE_URL: 'http://localhost:3000',
    EMAIL_PROVIDER: 'console',
    ...overrides,
  });

function rawKeys(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  return {
    privateKey: jwk.d ?? '',
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x ?? '', 'base64url'),
      Buffer.from(jwk.y ?? '', 'base64url'),
    ]).toString('base64url'),
  };
}

describe('push settings: defaults and interval', () => {
  it('defaults to the fake provider and a 10 second interval; 1 and 60 are valid', () => {
    const env = workerLocal()();
    expect(env.PUSH_PROVIDER).toBe('fake');
    expect(env.PUSH_JOB_INTERVAL_SECONDS).toBe(10);
    expect(workerLocal({ PUSH_JOB_INTERVAL_SECONDS: '1' })().PUSH_JOB_INTERVAL_SECONDS).toBe(1);
    expect(workerLocal({ PUSH_JOB_INTERVAL_SECONDS: '60' })().PUSH_JOB_INTERVAL_SECONDS).toBe(60);
    expect(parseEnv(testEnvSource()).PUSH_PROVIDER).toBe('fake');
  });

  it.each(['0', '61', '1.5', 'abc'])('rejects PUSH_JOB_INTERVAL_SECONDS=%s naming it', (value) => {
    expect(workerLocal({ PUSH_JOB_INTERVAL_SECONDS: value })).toThrow(/PUSH_JOB_INTERVAL_SECONDS/);
  });
});

describe('push settings: production rules', () => {
  it('accepts a complete production configuration in the API and the worker', () => {
    expect(workerProd()().VAPID_PRIVATE_KEY).toBe(PRIVATE_KEY);
    expect(apiProd()().VAPID_PUBLIC_KEY).toBe(PUBLIC_KEY);
  });

  it('refuses the fake provider in production, in the API and the worker', () => {
    expect(apiProd({ PUSH_PROVIDER: 'fake' })).toThrow(/PUSH_PROVIDER/);
    expect(workerProd({ PUSH_PROVIDER: 'fake' })).toThrow(/PUSH_PROVIDER/);
  });

  it('requires the public key in production, in the API and the worker, blank counting as unset', () => {
    expect(apiProd({ VAPID_PUBLIC_KEY: undefined })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(apiProd({ VAPID_PUBLIC_KEY: '' })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(workerProd({ VAPID_PUBLIC_KEY: undefined })).toThrow(/VAPID_PUBLIC_KEY/);
  });

  it('requires the private key and the subject in the worker, naming them without values', () => {
    expect(workerProd({ VAPID_PRIVATE_KEY: undefined })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(workerProd({ VAPID_SUBJECT: undefined })).toThrow(/VAPID_SUBJECT/);
    const bad = workerProd({ VAPID_PRIVATE_KEY: 'x'.repeat(10) });
    expect(bad).toThrow(/VAPID_PRIVATE_KEY/);
    expect(bad).not.toThrow(/xxxxxxxxxx/);
  });

  it('rejects a public key of 64 bytes and a private key of 31 bytes', () => {
    const shortPublic = Buffer.concat([Buffer.from([4]), Buffer.alloc(63, 1)]).toString('base64url');
    expect(workerProd({ VAPID_PUBLIC_KEY: shortPublic })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(apiProd({ VAPID_PUBLIC_KEY: shortPublic })).toThrow(/VAPID_PUBLIC_KEY/);
    const notPoint = Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 1)]).toString('base64url');
    expect(apiProd({ VAPID_PUBLIC_KEY: notPoint })).toThrow(/VAPID_PUBLIC_KEY/);
    const shortPrivate = Buffer.alloc(31, 7).toString('base64url');
    expect(workerProd({ VAPID_PRIVATE_KEY: shortPrivate })).toThrow(/VAPID_PRIVATE_KEY/);
  });

  it('rejects a private key that does not derive the public key, naming the variable only', () => {
    const other = rawKeys();
    const mismatch = workerProd({ VAPID_PRIVATE_KEY: other.privateKey });
    expect(mismatch).toThrow(/VAPID_PRIVATE_KEY/);
    expect(mismatch).not.toThrow(new RegExp(other.privateKey));
  });
});

describe('push settings: subject', () => {
  it.each(['ftp://x', 'https://', 'https://a b.example', 'mailto:', 'https://x.example\nmore'])(
    'rejects VAPID_SUBJECT %j with the worker refusing to start',
    (value) => {
      expect(workerProd({ VAPID_SUBJECT: value })).toThrow(/VAPID_SUBJECT/);
    },
  );

  it.each(['mailto:ops@example.com', 'https://pesly.com.ar/contact'])('accepts %s', (value) => {
    expect(workerProd({ VAPID_SUBJECT: value })().VAPID_SUBJECT).toBe(value);
  });

  it('rejects a subject longer than 255 characters', () => {
    expect(workerProd({ VAPID_SUBJECT: `mailto:${'a'.repeat(250)}@x.io` })).toThrow(/VAPID_SUBJECT/);
  });
});

describe('push settings: API isolation and local use', () => {
  it('parses the API without the private key and ignores it when set', () => {
    const env = apiProd({ VAPID_PRIVATE_KEY: PRIVATE_KEY, VAPID_SUBJECT: SUBJECT })();
    expect(env).not.toHaveProperty('VAPID_PRIVATE_KEY');
    expect(env).not.toHaveProperty('VAPID_SUBJECT');
    expect(env).not.toHaveProperty('PUSH_JOB_INTERVAL_SECONDS');
    expect(JSON.stringify(env)).not.toContain(PRIVATE_KEY);
  });

  it('accepts the fake provider with no keys outside production', () => {
    const worker = workerLocal()();
    expect(worker.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(worker.VAPID_PRIVATE_KEY).toBeUndefined();
    const api = parseEnv(testEnvSource({ VAPID_PUBLIC_KEY: '' }));
    expect(api.VAPID_PUBLIC_KEY).toBeUndefined();
  });

  it('requires the keys and the subject outside production when the provider is webpush', () => {
    expect(workerLocal({ PUSH_PROVIDER: 'webpush' })).toThrow(/VAPID_PRIVATE_KEY/);
  });
});

describe('key generation script', () => {
  it('prints a pair that passes the worker production key rules', () => {
    const script = fileURLToPath(new URL('../../scripts/generate-vapid-keys.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    const lines = Object.fromEntries(
      output
        .split(/\r?\n/)
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    expect(Object.keys(lines).sort()).toEqual(['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']);
    const env = workerProd({
      VAPID_PUBLIC_KEY: lines.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: lines.VAPID_PRIVATE_KEY,
    })();
    expect(env.VAPID_PUBLIC_KEY).toBe(lines.VAPID_PUBLIC_KEY);
  });
});
