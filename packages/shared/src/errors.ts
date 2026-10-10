import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'EMAIL_NOT_VERIFIED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_BREACHED',
  'PASSWORD_CHECK_UNAVAILABLE',
  'TOKEN_INVALID',
  'INVALID_CREDENTIALS',
  'TOTP_INVALID',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_NOT_ENABLED',
  'TWO_FACTOR_SETUP_REQUIRED',
  'TWO_FACTOR_UNAVAILABLE',
  'SECOND_FACTOR_INVALID',
  'SECOND_FACTOR_EXPIRED',
  'ACCOUNT_NAME_TAKEN',
  'ACCOUNT_HAS_MOVEMENTS',
  'CATEGORY_NAME_TAKEN',
  'CATEGORY_IN_USE',
  'CATEGORY_NESTING_TOO_DEEP',
  'CATEGORY_PARENT_KIND_MISMATCH',
  'REAUTHENTICATION_REQUIRED',
  'ACCOUNT_ARCHIVED',
  'MOVEMENT_DATE_IN_FUTURE',
  'RATE_REQUIRED',
  'MOVEMENT_CATEGORY_KIND_MISMATCH',
  'CATEGORY_ARCHIVED',
  'MOVEMENT_SAME_ACCOUNT',
  'MOVEMENT_CURRENCY_MISMATCH',
  'EXCHANGE_SAME_CURRENCY',
  'IMPLIED_RATE_OUT_OF_RANGE',
  'MOVEMENT_TYPE_IMMUTABLE',
  'ACCOUNT_LINKED_TO_CARD',
  'CARD_HAS_MOVEMENTS',
  'STATEMENT_CLOSED',
  'RECURRING_OCCURRENCE_NOT_PENDING',
  'RECURRING_LIMIT_REACHED',
  'GROUP_ADMIN_REQUIRED',
  'GROUP_ALREADY_MEMBER',
  'GROUP_MEMBER_LIMIT_REACHED',
  'GROUP_MEMBER_NOT_REGISTERED',
  'GROUP_SPLIT_PERCENTAGE_INVALID',
  'GROUP_SPLIT_AMOUNT_MISMATCH',
  'GROUP_SPLIT_MEMBER_INVALID',
  'GROUP_EXPENSE_CATEGORY_INVALID',
  'GROUP_PAYER_ACCOUNT_INVALID',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * Body of every API error response. `fields` lists failing input paths, never their values;
 * `details` carries named integer values (as strings) a client needs to explain the failure, such
 * as the total of a percentage split.
 */
export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  fields: z.array(z.string()).optional(),
  details: z.record(z.string(), z.string()).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Base class for typed application and domain errors. The API error handler maps `code` to an
 * HTTP status; the web client maps it to a message key.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Failing input paths (`<part>.<path>`), never values; the error handler echoes them. */
  readonly fields: readonly string[] | undefined;
  /** Named integer values as strings (never user text); the error handler echoes them. */
  readonly details: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ErrorCode,
    message: string = code,
    fields?: string[],
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

/**
 * An error whose HTTP answer carries a `Retry-After` header. The error handler reads
 * `retryAfterSeconds` from any instance, so the header is not tied to one error code.
 */
export class RetryableError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(
    code: ErrorCode,
    retryAfterSeconds: number,
    message: string = code,
    fields?: string[],
  ) {
    if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
      throw new RangeError('retryAfterSeconds must be a positive integer');
    }
    super(code, message, fields);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
