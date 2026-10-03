import { z } from 'zod';

/** Sender for local transports (console, Mailpit) when EMAIL_FROM is unset. */
const LOCAL_EMAIL_FROM = 'Pesly <no-reply@pesly.local>';

const jwtSecretSchema = z.string().min(32, 'must be at least 32 characters (256 bits)');

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TOTP_KEY_BYTES = 32;

/** Standard base64 of exactly 32 bytes (an AES-256 key); never padded or truncated to fit. */
const totpEncryptionKeySchema = z
  .string()
  .refine(
    (value) =>
      BASE64.test(value) &&
      value.length % 4 === 0 &&
      Buffer.from(value, 'base64').length === TOTP_KEY_BYTES,
    `must be base64 of exactly ${TOTP_KEY_BYTES} bytes`,
  );

/** Google's OpenID Connect endpoints; only a local fake OIDC server replaces them, never in production. */
export const GOOGLE_ENDPOINT_DEFAULTS = {
  GOOGLE_AUTHORIZATION_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_JWKS_URL: 'https://www.googleapis.com/oauth2/v3/certs',
  GOOGLE_ISSUER: 'https://accounts.google.com',
} as const;

type GoogleEndpoint = keyof typeof GOOGLE_ENDPOINT_DEFAULTS;
const GOOGLE_ENDPOINTS = Object.keys(GOOGLE_ENDPOINT_DEFAULTS) as GoogleEndpoint[];

/** An empty value (a blank line copied from .env.example) counts as unset. */
function optionalSetting<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

function googleEndpoint(name: GoogleEndpoint) {
  return z.preprocess(
    (value) => (value === '' || value === undefined ? GOOGLE_ENDPOINT_DEFAULTS[name] : value),
    z.url(),
  );
}

/** The only dolarapi host production may call; only a local fake server replaces it elsewhere. */
export const DOLARAPI_BASE_URL_DEFAULT = 'https://dolarapi.com';

/** The only CoinGecko host production may call; only a local fake server replaces it elsewhere. */
export const COINGECKO_BASE_URL_DEFAULT = 'https://api.coingecko.com/api/v3';

/**
 * A pasted secret often carries a trailing newline or space, so the value is trimmed first; a blank
 * one counts as unset. What remains must be one visible ASCII token, so a malformed key stops
 * startup naming the variable, never the value.
 */
const coingeckoKeySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z
    .string()
    .max(255)
    .regex(/^[!-~]+$/, 'must be a single token without spaces')
    .optional(),
);

type Issue = { path: string[]; message: string };

/**
 * The settings the email worker reads. The worker parses only these, so a setting the API alone
 * needs (its JWT secret, the Google client) can neither stop the worker nor be handed to it.
 */
const workerFields = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  WEB_BASE_URL: z.url(),
  // No default: which provider delivers email must be a deliberate choice per environment.
  EMAIL_PROVIDER: z.enum(['console', 'mailpit', 'resend']),
  RESEND_API_KEY: z.string().optional(),
  /** Which adapter feeds the exchange rates; `fake` is for local runs and e2e only. */
  RATE_PROVIDER: z.enum(['dolarapi', 'fake']).default('dolarapi'),
  DOLARAPI_BASE_URL: z.url().default(DOLARAPI_BASE_URL_DEFAULT),
  /** Which adapter prices crypto; `fake` is for local runs and e2e only. */
  PRICE_PROVIDER: z.enum(['coingecko', 'fake']).default('coingecko'),
  COINGECKO_BASE_URL: z.url().default(COINGECKO_BASE_URL_DEFAULT),
  /** Optional Demo plan key: a missing key never blocks startup; only a malformed one does. */
  COINGECKO_API_KEY: coingeckoKeySchema,
  /** Sender of auth emails; required with Resend, whose sending domain must be verified. */
  EMAIL_FROM: z
    .string()
    .min(3)
    .max(254)
    .regex(/^[^\r\n]+$/, 'must be a single line')
    .optional(),
};

interface RawWorkerEnv {
  NODE_ENV: string;
  EMAIL_PROVIDER: string;
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  WEB_BASE_URL: string;
  RATE_PROVIDER: string;
  DOLARAPI_BASE_URL: string;
  PRICE_PROVIDER: string;
  COINGECKO_BASE_URL: string;
}

interface RawEnv extends RawWorkerEnv {
  JWT_SECRET: string;
  BREACH_CHECKER: string;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  TRUST_PROXY: number;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_AUTHORIZATION_URL: string;
  GOOGLE_TOKEN_URL: string;
  GOOGLE_JWKS_URL: string;
  GOOGLE_ISSUER: string;
  TOTP_ENCRYPTION_KEY?: string | undefined;
}

function httpsIssue(name: string, value: string): Issue[] {
  return URL.canParse(value) && new URL(value).protocol === 'https:'
    ? []
    : [{ path: [name], message: 'must use https: in production' }];
}

/** Rules on the email settings, in every environment. */
function emailIssues(env: RawWorkerEnv): Issue[] {
  const issues: Issue[] = [];
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    issues.push({ path: ['RESEND_API_KEY'], message: 'required when EMAIL_PROVIDER=resend' });
  }
  if (env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_FROM) {
    issues.push({ path: ['EMAIL_FROM'], message: 'required when EMAIL_PROVIDER=resend' });
  }
  // Outside production the Resend SDK prints raw provider errors (which can echo the recipient
  // address) to the console, bypassing the logger's redaction.
  if (env.EMAIL_PROVIDER === 'resend' && env.NODE_ENV !== 'production') {
    issues.push({ path: ['EMAIL_PROVIDER'], message: 'resend requires NODE_ENV=production' });
  }
  return issues;
}

/** Production rules on the settings the worker reads: a real provider and https links. */
function workerProductionIssues(env: RawWorkerEnv): Issue[] {
  const issues: Issue[] = [];
  if (env.EMAIL_PROVIDER !== 'resend') {
    issues.push({ path: ['EMAIL_PROVIDER'], message: 'must be resend in production' });
  }
  if (env.RATE_PROVIDER !== 'dolarapi') {
    issues.push({ path: ['RATE_PROVIDER'], message: 'must be dolarapi in production' });
  }
  // A misconfigured URL would send the worker's requests somewhere else.
  if (env.DOLARAPI_BASE_URL !== DOLARAPI_BASE_URL_DEFAULT) {
    issues.push({
      path: ['DOLARAPI_BASE_URL'],
      message: 'must be the default dolarapi endpoint in production',
    });
  }
  if (env.PRICE_PROVIDER !== 'coingecko') {
    issues.push({ path: ['PRICE_PROVIDER'], message: 'must be coingecko in production' });
  }
  if (env.COINGECKO_BASE_URL !== COINGECKO_BASE_URL_DEFAULT) {
    issues.push({
      path: ['COINGECKO_BASE_URL'],
      message: 'must be the default CoinGecko endpoint in production',
    });
  }
  return [...issues, ...httpsIssue('WEB_BASE_URL', env.WEB_BASE_URL)];
}

/** Settings that are fine locally but unsafe in production: fakes, plain http, no proxy trust. */
function productionIssues(env: RawEnv): Issue[] {
  const issues: Issue[] = [];
  if (env.JWT_SECRET.startsWith('change-me')) {
    issues.push({ path: ['JWT_SECRET'], message: 'must not be the .env.example placeholder' });
  }
  issues.push(...workerProductionIssues(env));
  if (env.BREACH_CHECKER !== 'hibp') {
    issues.push({ path: ['BREACH_CHECKER'], message: 'must be hibp in production' });
  }
  for (const name of ['WEB_ORIGIN', 'API_ORIGIN'] as const) {
    issues.push(...httpsIssue(name, env[name]));
  }
  if (env.TRUST_PROXY < 1) {
    issues.push({
      path: ['TRUST_PROXY'],
      message: 'must be at least 1 in production (TLS ends at the hosting proxy)',
    });
  }
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOTP_ENCRYPTION_KEY'] as const) {
    if (!env[name]) issues.push({ path: [name], message: 'required in production' });
  }
  // A misconfigured endpoint would send the client secret, or accept ID tokens, somewhere else.
  for (const name of GOOGLE_ENDPOINTS) {
    if (env[name] !== GOOGLE_ENDPOINT_DEFAULTS[name]) {
      issues.push({ path: [name], message: "must be Google's endpoint in production" });
    }
  }
  return issues;
}

const envSchema = z
  .object({
    ...workerFields,
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    JWT_SECRET: jwtSecretSchema,
    WEB_ORIGIN: z.url(),
    API_ORIGIN: z.url(),
    BREACH_CHECKER: z.enum(['hibp', 'fake']).default('hibp'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Unset outside production disables Google sign-in. */
    GOOGLE_CLIENT_ID: optionalSetting(z.string().trim().min(1).max(255)),
    GOOGLE_CLIENT_SECRET: optionalSetting(z.string().trim().min(1).max(255)),
    GOOGLE_AUTHORIZATION_URL: googleEndpoint('GOOGLE_AUTHORIZATION_URL'),
    GOOGLE_TOKEN_URL: googleEndpoint('GOOGLE_TOKEN_URL'),
    GOOGLE_JWKS_URL: googleEndpoint('GOOGLE_JWKS_URL'),
    GOOGLE_ISSUER: googleEndpoint('GOOGLE_ISSUER'),
    /**
     * Encrypts TOTP secrets at rest (AES-256-GCM). Unset outside production makes 2FA unavailable.
     * The email worker parses this environment too, so production needs it on both services.
     */
    TOTP_ENCRYPTION_KEY: optionalSetting(totpEncryptionKeySchema),
  })
  .superRefine((env, ctx) => {
    for (const issue of emailIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'required when GOOGLE_CLIENT_ID is set',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const issue of productionIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    }
  })
  .transform((env) => ({
    ...env,
    // Only console and mailpit can get here without one (resend requires it above).
    EMAIL_FROM: env.EMAIL_FROM ?? LOCAL_EMAIL_FROM,
    WEB_ORIGIN: new URL(env.WEB_ORIGIN).origin,
    API_ORIGIN: new URL(env.API_ORIGIN).origin,
  }));

const workerEnvSchema = z
  .object(workerFields)
  .superRefine((env, ctx) => {
    for (const issue of emailIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    if (env.NODE_ENV === 'production') {
      for (const issue of workerProductionIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    }
  })
  .transform((env) => ({
    ...env,
    // Only console and mailpit can get here without one (resend requires it above).
    EMAIL_FROM: env.EMAIL_FROM ?? LOCAL_EMAIL_FROM,
  }));

export type Env = z.infer<typeof envSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Throws listing the invalid variable names and rules, never their values. */
function parseWith<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

/** Parses and validates the API's environment. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(envSchema, source);
}

/** Parses and validates the email worker's environment: only the settings it reads. */
export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseWith(workerEnvSchema, source);
}
