import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

// Email addresses are PII: never logged under the keys that carry them. A bare `to` is only an
// address inside an email message; elsewhere (e.g. a transfer's destination) it is kept.
const SECRET_KEYS = [
  'password',
  'newPassword',
  'token',
  'cookies',
  'authorization',
  'email',
  'toEmail',
  'to_email',
  'message.to',
  // OAuth / OpenID Connect secrets (Google sign-in). The authorization `code` is listed apart, only
  // inside a query or body: elsewhere `code` is an error code (`code`, `err.code`, `err.cause.code`).
  'state',
  'id_token',
  'idToken',
  'code_verifier',
  'codeVerifier',
  'client_secret',
  'clientSecret',
  'binding',
  'nonce',
  // Two-factor secrets (DISC-001-01c): the TOTP secret, its URI and the recovery codes. TOTP and
  // recovery codes sent by the user travel as `code`, redacted below at body level.
  'secret',
  'otpauthUri',
  'recoveryCodes',
  // Account deletion (DISC-001-01f): the second-factor code, the re-authentication grant and the
  // Google URL that carries the state, nonce and code challenge.
  'secondFactorCode',
  'grantToken',
  'grant',
  'authorizationUrl',
  // Web Push (DISC-001-08d): the push URL is a capability, the keys and the auth secret decrypt
  // what is sent to the device, and the VAPID private key signs as the server.
  'endpoint',
  'p256dh',
  'authSecret',
  'vapidPrivateKey',
  'VAPID_PRIVATE_KEY',
];

/**
 * pino redaction wildcards match exactly one level, so every secret key is listed at the top level
 * and up to two levels deep (e.g. `body.password`, `req.body.password`).
 */
export const REDACT_PATHS = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  ...SECRET_KEYS.map((key) => `*.*.${key}`),
  'query.code',
  'body.code',
  '*.query.code',
  '*.body.code',
  // `auth` alone is too common a key to redact everywhere: only the subscription keys of a body.
  'body.keys.auth',
  '*.body.keys.auth',
  'keys.auth',
  '*.keys.auth',
  'headers.cookie',
  'headers["set-cookie"]',
  '*.headers.cookie',
  '*.headers["set-cookie"]',
];

/** PostgreSQL error fields that identify the failure without carrying row values. */
const SAFE_PG_FIELDS = ['code', 'severity', 'constraint', 'table', 'column', 'schema', 'routine'];

const MAX_CAUSE_DEPTH = 5;

type SerializedError = Record<string, unknown>;

interface QueryError extends Error {
  query: string;
  params: unknown;
}

/** Drizzle's DrizzleQueryError: its message embeds the bound params (emails, token hashes...). */
function isQueryError(error: Error): error is QueryError {
  return 'query' in error && typeof error.query === 'string' && 'params' in error;
}

interface PgError extends Error {
  code: string;
}

function isPgError(error: Error): error is PgError {
  return 'code' in error && typeof error.code === 'string' && 'severity' in error;
}

/** SQLSTATE class 22 (data exception) messages echo the offending input value. */
function isPgDataException(error: PgError): boolean {
  return error.code.startsWith('22');
}

/** Replaces the header line(s) of a stack (which repeat the message) with a safe message. */
function stackWithMessage(error: Error, safeMessage: string): string | undefined {
  if (!error.stack) return undefined;
  const firstFrame = error.stack.search(/\n\s+at /);
  const frames = firstFrame === -1 ? '' : error.stack.slice(firstFrame);
  return `${error.name}: ${safeMessage}${frames}`;
}

function serializeKnownError(value: Error, depth: number): SerializedError {
  let serialized: SerializedError;
  if (isQueryError(value)) {
    const message = 'Failed query';
    serialized = {
      type: value.constructor.name,
      message,
      query: value.query,
      stack: stackWithMessage(value, message),
    };
  } else if (isPgError(value)) {
    const message = isPgDataException(value) ? `pg data exception ${value.code}` : value.message;
    serialized = {
      type: value.constructor.name,
      message,
      stack: message === value.message ? value.stack : stackWithMessage(value, message),
    };
    for (const field of SAFE_PG_FIELDS) {
      const fieldValue: unknown = Reflect.get(value, field);
      if (fieldValue !== undefined) serialized[field] = fieldValue;
    }
  } else {
    serialized = { type: value.constructor.name, message: value.message, stack: value.stack };
    if ('code' in value && typeof value.code === 'string') serialized.code = value.code;
  }

  if (value.cause !== undefined) {
    serialized.cause =
      depth < MAX_CAUSE_DEPTH ? serializeError(value.cause, depth + 1) : '[cause depth exceeded]';
  }
  return serialized;
}

function safeTypeName(value: object): string {
  try {
    return value.constructor.name;
  } catch {
    return 'unknown';
  }
}

/**
 * Error serializer used for every `err` field. Unlike pino's default, it never copies query
 * params, pg `detail`/`hint`/`where`, data-exception messages, non-Error thrown values or arbitrary
 * enumerable properties, and it serializes the `cause` chain with the same rules instead of
 * concatenating cause messages. It never throws: logging must not turn one failure into two.
 */
export function serializeError(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) {
    // Thrown non-Errors can be anything (a row, a request body); only their kind is logged.
    const label = depth === 0 ? 'non-error thrown' : 'non-error cause';
    const message = `[${label}: ${typeof value}]`;
    return depth === 0 ? { type: typeof value, message } : message;
  }
  try {
    return serializeKnownError(value, depth);
  } catch {
    return { type: safeTypeName(value), message: '[unserializable error]' };
  }
}

export interface LoggerOptions {
  level?: string;
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { err: (error: unknown) => serializeError(error) },
    },
    options.destination,
  );
}
