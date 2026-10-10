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

describe('group error codes over HTTP', () => {
  it.each<[ErrorCode, number]>([
    ['GROUP_ADMIN_REQUIRED', 403],
    ['GROUP_ALREADY_MEMBER', 409],
    ['GROUP_MEMBER_LIMIT_REACHED', 409],
    ['GROUP_MEMBER_NOT_REGISTERED', 409],
  ])('%s answers %i with its code in the body (AC-08, AC-16)', async (code, status) => {
    const response = await request(appThrowing(code)).get('/boom');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
  });
});
