import { AppError, ERROR_CODES, RetryableError } from '@pesly/shared';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ReauthenticationRequired } from '../../src/identity/domain/errors';
import { createLogger } from '../../src/shared/logging/logger';
import type { Env } from '../../src/shared/config/env';
import { productionEnv, testEnv } from '../helpers/test-env';

function buildApp(env: Env, lines: string[] = []) {
  const router = Router();
  router.get('/boom', () => {
    throw new Error('relation "users" does not exist at SELECT * FROM users');
  });
  router.get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error('async failure with SQL detail');
  });
  router.get('/too-short', async () => {
    await Promise.resolve();
    throw new AppError('PASSWORD_TOO_SHORT');
  });
  router.get('/name-taken', () => {
    throw new AppError('ACCOUNT_NAME_TAKEN');
  });
  router.get('/has-movements', () => {
    throw new AppError('ACCOUNT_HAS_MOVEMENTS');
  });
  router.get('/category-name-taken', () => {
    throw new AppError('CATEGORY_NAME_TAKEN');
  });
  router.get('/category-in-use', () => {
    throw new AppError('CATEGORY_IN_USE');
  });
  router.get('/category-nesting', () => {
    throw new AppError('CATEGORY_NESTING_TOO_DEEP');
  });
  router.get('/category-kind', () => {
    throw new AppError('CATEGORY_PARENT_KIND_MISMATCH');
  });

  router.get('/reauth', () => {
    throw new ReauthenticationRequired();
  });
  router.get('/archived', () => {
    throw new AppError('ACCOUNT_ARCHIVED');
  });
  router.get('/movement-future', () => {
    throw new AppError('MOVEMENT_DATE_IN_FUTURE');
  });
  router.get('/movement-type-immutable', () => {
    throw new AppError('MOVEMENT_TYPE_IMMUTABLE');
  });
  router.get('/rate-required', () => {
    throw new AppError('RATE_REQUIRED');
  });
  router.get('/movement-kind', () => {
    throw new AppError('MOVEMENT_CATEGORY_KIND_MISMATCH');
  });
  router.get('/category-archived', () => {
    throw new AppError('CATEGORY_ARCHIVED');
  });
  router.get('/movement-same-account', () => {
    throw new AppError('MOVEMENT_SAME_ACCOUNT');
  });
  router.get('/movement-currency-mismatch', () => {
    throw new AppError('MOVEMENT_CURRENCY_MISMATCH');
  });
  router.get('/exchange-same-currency', () => {
    throw new AppError('EXCHANGE_SAME_CURRENCY');
  });
  router.get('/implied-rate-out-of-range', () => {
    throw new AppError('IMPLIED_RATE_OUT_OF_RANGE');
  });
  router.get('/retryable', () => {
    throw new RetryableError('RATE_LIMITED', 42);
  });
  router.get('/fields', () => {
    throw new AppError('VALIDATION_FAILED', 'detail', ['body.someField']);
  });
  router.get('/no-fields', () => {
    throw new AppError('VALIDATION_FAILED');
  });
  const logger = createLogger({
    level: 'info',
    destination: { write: (line: string) => lines.push(line) },
  });
  return createApp({ env, logger, routers: [router] });
}

describe('error handler', () => {
  it('returns 500 INTERNAL without stack or SQL message in production and logs the request id', async () => {
    const lines: string[] = [];
    const response = await request(buildApp(productionEnv(), lines))
      .get('/boom')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    expect(response.text).not.toContain('SELECT');
    expect(response.text).not.toContain('at ');

    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.any(String));
    const errorLine = lines.find((line) => line.includes('"code":"INTERNAL"'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain(`"requestId":"${String(requestId)}"`);
  });

  it('routes rejected promises from async handlers to the error handler', async () => {
    const response = await request(buildApp(productionEnv()))
      .get('/async-boom')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
  });

  it('maps a known application error (PASSWORD_TOO_SHORT) to 400 with its code', async () => {
    const response = await request(buildApp(testEnv())).get('/too-short');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'PASSWORD_TOO_SHORT' });
  });

  it('maps ACCOUNT_NAME_TAKEN to 409 with only its code', async () => {
    const response = await request(buildApp(testEnv())).get('/name-taken');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_NAME_TAKEN' });
  });

  it('maps ACCOUNT_HAS_MOVEMENTS to 409 with only its code', async () => {
    const response = await request(buildApp(testEnv())).get('/has-movements');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
  });

  it.each([
    ['/category-name-taken', 409, 'CATEGORY_NAME_TAKEN'],
    ['/category-in-use', 409, 'CATEGORY_IN_USE'],
    ['/category-nesting', 400, 'CATEGORY_NESTING_TOO_DEEP'],
    ['/category-kind', 400, 'CATEGORY_PARENT_KIND_MISMATCH'],
  ] as const)('maps %s to %i with only its code', async (path, status, code) => {
    const response = await request(buildApp(testEnv())).get(path);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
  });

  it('maps REAUTHENTICATION_REQUIRED to 401 with only its code (AC-09)', async () => {
    expect(ERROR_CODES).toContain('REAUTHENTICATION_REQUIRED');
    const response = await request(buildApp(testEnv())).get('/reauth');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'REAUTHENTICATION_REQUIRED' });
  });

  it('maps ACCOUNT_ARCHIVED to 409 with only its code (FR-06)', async () => {
    const response = await request(buildApp(testEnv())).get('/archived');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
  });

  it.each([
    ['/movement-future', 400, 'MOVEMENT_DATE_IN_FUTURE'],
    ['/movement-type-immutable', 409, 'MOVEMENT_TYPE_IMMUTABLE'],
    ['/rate-required', 400, 'RATE_REQUIRED'],
    ['/movement-kind', 400, 'MOVEMENT_CATEGORY_KIND_MISMATCH'],
    ['/category-archived', 409, 'CATEGORY_ARCHIVED'],
    ['/movement-same-account', 400, 'MOVEMENT_SAME_ACCOUNT'],
    ['/movement-currency-mismatch', 400, 'MOVEMENT_CURRENCY_MISMATCH'],
    ['/exchange-same-currency', 400, 'EXCHANGE_SAME_CURRENCY'],
    ['/implied-rate-out-of-range', 400, 'IMPLIED_RATE_OUT_OF_RANGE'],
  ] as const)('maps %s to %i with only its code and no Retry-After', async (path, status, code) => {
    const response = await request(buildApp(testEnv())).get(path);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ code });
    expect(response.headers['retry-after']).toBeUndefined();
  });

  it('maps a RetryableError to 429 with a Retry-After header and only its code', async () => {
    const response = await request(buildApp(testEnv())).get('/retryable');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(response.body).toEqual({ code: 'RATE_LIMITED' });
  });

  it('emits fields for any AppError that carries them', async () => {
    const response = await request(buildApp(testEnv())).get('/fields');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.someField'] });
    expect(response.text).not.toContain('detail');
  });

  it('omits fields for an AppError without them', async () => {
    const response = await request(buildApp(testEnv())).get('/no-fields');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    const response = await request(buildApp(testEnv())).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
  });
});
