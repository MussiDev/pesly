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

describe('group expense error codes over HTTP', () => {
  it.each<ErrorCode>([
    'GROUP_SPLIT_PERCENTAGE_INVALID',
    'GROUP_SPLIT_AMOUNT_MISMATCH',
    'GROUP_SPLIT_MEMBER_INVALID',
    'GROUP_EXPENSE_CATEGORY_INVALID',
    'GROUP_PAYER_ACCOUNT_INVALID',
  ])('%s answers 400 with its code in the body (AC-09, AC-11)', async (code) => {
    const response = await request(appThrowing(code)).get('/boom');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code });
  });

  it('echoes the details of an error that carries them (AC-09, AC-11)', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new AppError('GROUP_SPLIT_AMOUNT_MISMATCH', 'mismatch', undefined, {
        difference: '-300',
      });
    });
    app.use(createErrorHandler(createLogger({ level: 'silent' })));
    const response = await request(app).get('/boom');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'GROUP_SPLIT_AMOUNT_MISMATCH',
      details: { difference: '-300' },
    });
  });
});
