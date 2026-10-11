import express from 'express';
import request from 'supertest';
import { AppError, type ErrorCode } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logging/logger';
import { createErrorHandler } from '../../src/shared/http/error-handler';

function appThrowing(code: ErrorCode) {
  const app = express();
  app.get('/boom', () => {
    throw new AppError(code);
  });
  app.use(createErrorHandler(createLogger({ level: 'silent' })));
  return app;
}

describe('goal error codes over HTTP', () => {
  it.each([
    'GOAL_ACCOUNT_CURRENCY_MISMATCH',
    'GOAL_LINKED_TO_ACCOUNT',
    'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS',
    'GOAL_PROGRESS_TOO_LARGE',
    'GOAL_LIMIT_REACHED',
    'ACCOUNT_LINKED_TO_GOAL',
  ] as ErrorCode[])(
    '%s answers 409 with its code in the body (AC-03, AC-07, AC-19, AC-23, AC-24)',
    async (code) => {
      const response = await request(appThrowing(code)).get('/boom');
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ code });
    },
  );
});
