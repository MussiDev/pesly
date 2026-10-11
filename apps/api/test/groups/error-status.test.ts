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

describe('group settlement and membership error codes over HTTP', () => {
  it.each<[ErrorCode, number]>([
    ['GROUP_SETTLEMENT_MEMBER_INVALID', 400],
    ['GROUP_SETTLEMENT_ACCOUNT_INVALID', 400],
    ['GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE', 400],
    ['GROUP_MEMBER_HAS_BALANCE', 409],
    ['GROUP_LAST_ADMIN', 409],
    ['GROUP_SETTLEMENT_STALE', 409],
  ])('%s answers %i with its code in the body (AC-16, AC-19)', async (code, status) => {
    const response = await request(appThrowing(code)).get('/boom');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
  });
});

describe('group record change error codes over HTTP', () => {
  it.each<[ErrorCode, number]>([
    ['GROUP_RECORD_EDIT_FORBIDDEN', 403],
    ['GROUP_RECORD_FORMER_MEMBER', 409],
    ['GROUP_SETTLEMENT_CONSOLIDATED', 409],
    ['GROUP_ACTIVITY_LOG_IMMUTABLE', 405],
  ])('%s answers %i with its code in the body (AC-03, AC-11)', async (code, status) => {
    const response = await request(appThrowing(code)).get('/boom');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
  });

  it('a 405 carries an empty Allow header: the log entry allows no method', async () => {
    const response = await request(appThrowing('GROUP_ACTIVITY_LOG_IMMUTABLE')).get('/boom');
    expect(response.headers).toHaveProperty('allow');
    expect(response.headers.allow).toBe('');
  });

  it('a non-405 error carries no Allow header', async () => {
    const response = await request(appThrowing('GROUP_LAST_ADMIN')).get('/boom');
    expect(response.headers.allow).toBeUndefined();
  });
});
