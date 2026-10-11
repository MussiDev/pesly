import { AppError, RetryableError, type ErrorCode, type ErrorResponse } from '@pesly/shared';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import type { Logger } from '../logging/logger';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PASSWORD_TOO_SHORT: 400,
  PASSWORD_BREACHED: 400,
  PASSWORD_CHECK_UNAVAILABLE: 503,
  TOKEN_INVALID: 400,
  INVALID_CREDENTIALS: 401,
  TOTP_INVALID: 400,
  TWO_FACTOR_ALREADY_ENABLED: 409,
  TWO_FACTOR_NOT_ENABLED: 409,
  TWO_FACTOR_SETUP_REQUIRED: 409,
  TWO_FACTOR_UNAVAILABLE: 503,
  SECOND_FACTOR_INVALID: 401,
  SECOND_FACTOR_EXPIRED: 401,
  ACCOUNT_NAME_TAKEN: 409,
  ACCOUNT_HAS_MOVEMENTS: 409,
  CATEGORY_NAME_TAKEN: 409,
  CATEGORY_IN_USE: 409,
  CATEGORY_NESTING_TOO_DEEP: 400,
  CATEGORY_PARENT_KIND_MISMATCH: 400,
  REAUTHENTICATION_REQUIRED: 401,
  ACCOUNT_ARCHIVED: 409,
  MOVEMENT_DATE_IN_FUTURE: 400,
  RATE_REQUIRED: 400,
  MOVEMENT_CATEGORY_KIND_MISMATCH: 400,
  CATEGORY_ARCHIVED: 409,
  MOVEMENT_SAME_ACCOUNT: 400,
  MOVEMENT_CURRENCY_MISMATCH: 400,
  EXCHANGE_SAME_CURRENCY: 400,
  IMPLIED_RATE_OUT_OF_RANGE: 400,
  MOVEMENT_TYPE_IMMUTABLE: 409,
  ACCOUNT_LINKED_TO_CARD: 409,
  CARD_HAS_MOVEMENTS: 409,
  DEBIT_ACCOUNT_CURRENCY_MISMATCH: 400,
  DEBIT_ACCOUNT_IS_CARD_ACCOUNT: 400,
  STATEMENT_CLOSED: 409,
  RECURRING_OCCURRENCE_NOT_PENDING: 409,
  RECURRING_LIMIT_REACHED: 409,
  GROUP_ADMIN_REQUIRED: 403,
  GROUP_ALREADY_MEMBER: 409,
  GROUP_MEMBER_LIMIT_REACHED: 409,
  GROUP_MEMBER_NOT_REGISTERED: 409,
  GROUP_SPLIT_PERCENTAGE_INVALID: 400,
  GROUP_SPLIT_AMOUNT_MISMATCH: 400,
  GROUP_SPLIT_MEMBER_INVALID: 400,
  GROUP_EXPENSE_CATEGORY_INVALID: 400,
  GROUP_PAYER_ACCOUNT_INVALID: 400,
  GROUP_SETTLEMENT_MEMBER_INVALID: 400,
  GROUP_SETTLEMENT_ACCOUNT_INVALID: 400,
  GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE: 400,
  GROUP_MEMBER_HAS_BALANCE: 409,
  GROUP_LAST_ADMIN: 409,
  GROUP_SETTLEMENT_STALE: 409,
  GROUP_RECORD_EDIT_FORBIDDEN: 403,
  GROUP_RECORD_FORMER_MEMBER: 409,
  GROUP_SETTLEMENT_CONSOLIDATED: 409,
  GROUP_ACTIVITY_LOG_IMMUTABLE: 405,
  INTERNAL: 500,
};

/**
 * An error raised by the HTTP layer itself (validation, guards) whose status is not necessarily the
 * default one for its code, e.g. 403 or 413 `VALIDATION_FAILED`.
 */
export class HttpError extends AppError {
  readonly status: number;

  constructor(status: number, code: ErrorCode, fields?: string[]) {
    super(code, code, fields);
    this.status = status;
  }
}

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  );
}

interface MappedError {
  status: number;
  body: ErrorResponse;
  retryAfterSeconds?: number;
}

function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    const status = error instanceof HttpError ? error.status : STATUS_BY_CODE[error.code];
    const body: ErrorResponse = { code: error.code };
    if (error.fields) body.fields = [...error.fields];
    if (error.details) body.details = { ...error.details };
    return error instanceof RetryableError
      ? { status, body, retryAfterSeconds: error.retryAfterSeconds }
      : { status, body };
  }
  if (isBodyParserError(error)) {
    // Oversized (413), malformed (400) and unsupported-encoding (415) bodies.
    return { status: error.status, body: { code: 'VALIDATION_FAILED' } };
  }
  return { status: 500, body: { code: 'INTERNAL' } };
}

/**
 * The single mapping from errors to HTTP responses. Bodies carry only a stable code (plus failing
 * field paths for validation); stack traces and driver messages go to the log, never to the client.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const { status, body, retryAfterSeconds } = mapError(error);
    const context = {
      requestId: res.locals.requestId,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      status,
      code: body.code,
    };
    if (status >= 500) {
      logger.error({ ...context, err: error }, 'request failed');
    } else {
      logger.warn(context, 'request rejected');
    }
    if (retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(retryAfterSeconds));
    // RFC 9110: a 405 names the methods the target allows; a log entry allows none, so it is empty.
    if (status === 405) res.setHeader('Allow', '');
    res.status(status).json(body);
  };
}
