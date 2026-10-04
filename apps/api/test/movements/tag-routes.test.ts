import { randomUUID } from 'node:crypto';
import { listTagsResponseSchema, tagSuggestionsResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes, createTagRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

async function setup(): Promise<{
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  bobId: string;
}> {
  const logger = createLogger({ level: 'debug', destination: { write: () => undefined } });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createMovementRoutes({ db: connection.db, logger }),
      createTagRoutes({ db: connection.db }),
    ],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, ana, bob, anaId, bobId };
}

async function createWithTags(
  app: Express,
  cookies: SessionCookies,
  ownerId: string,
  tags: string[],
): Promise<void> {
  const response = await request(app)
    .post('/movements')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send({
      type: 'expense',
      accountId: await newAccount(connection.pool, ownerId),
      categoryId: await newCategory(connection.pool, ownerId, 'expense'),
      amount: '1000',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      rate: { source: 'manual', value: '14000000' },
      tags,
    });
  expect(response.status).toBe(201);
}

describe('GET /tags', () => {
  it('answers the callers tags that start with the prefix in any case, alphabetical (AC-05)', async () => {
    const s = await setup();
    await createWithTags(s.app, s.ana, s.anaId, ['Viaje', 'vino', 'Comida']);
    await createWithTags(s.app, s.bob, s.bobId, ['VisaBob']);
    const response = await request(s.app).get('/tags?prefix=VI').set('Cookie', cookieHeader(s.ana));
    expect(response.status).toBe(200);
    expect(tagSuggestionsResponseSchema.parse(response.body).items).toEqual(['Viaje', 'vino']);
  });

  it('honours limit and rejects an invalid prefix or limit with 400 without echoing it', async () => {
    const s = await setup();
    await createWithTags(s.app, s.ana, s.anaId, ['aa', 'ab', 'ac']);
    const limited = await request(s.app)
      .get('/tags?prefix=a&limit=2')
      .set('Cookie', cookieHeader(s.ana));
    expect(tagSuggestionsResponseSchema.parse(limited.body).items).toHaveLength(2);
    const invalid = [
      '',
      'prefix=',
      'prefix=a&limit=21',
      'prefix=a&limit=0',
      `prefix=${'z'.repeat(31)}`,
    ];
    for (const query of invalid) {
      const response = await request(s.app)
        .get(`/tags?${query}`)
        .set('Cookie', cookieHeader(s.ana));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(response.text).not.toContain('zzzzz');
    }
  });

  it('answers 401 without a session', async () => {
    const s = await setup();
    const response = await request(s.app).get('/tags?prefix=a');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('answers 403 EMAIL_NOT_VERIFIED for an unverified user', async () => {
    const s = await setup();
    const email = `eve-${randomUUID()}@example.com`;
    await seedUser(connection, { email, password: PASSWORD, verified: false });
    const eve = sessionFrom(await signIn(s.app, email, PASSWORD));
    const response = await request(s.app).get('/tags?prefix=a').set('Cookie', cookieHeader(eve));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('GET /tags/all', () => {
  const get = (app: Express, query: string, cookies?: SessionCookies) => {
    const call = request(app).get(`/tags/all${query}`);
    if (cookies) call.set('Cookie', cookieHeader(cookies));
    return call;
  };

  it('lists the callers tags sorted and paged, with total, limit and offset (FR-01)', async () => {
    const s = await setup();
    await createWithTags(s.app, s.ana, s.anaId, ['Viaje', 'vino', 'Comida']);

    const all = await get(s.app, '', s.ana);
    expect(all.status).toBe(200);
    expect(listTagsResponseSchema.parse(all.body)).toEqual({
      items: ['Comida', 'Viaje', 'vino'],
      total: 3,
      limit: 50,
      offset: 0,
    });

    const paged = await get(s.app, '?limit=2&offset=1', s.ana);
    expect(listTagsResponseSchema.parse(paged.body)).toEqual({
      items: ['Viaje', 'vino'],
      total: 3,
      limit: 2,
      offset: 1,
    });
  });

  it('never returns the tags of another user (FR-01)', async () => {
    const s = await setup();
    await createWithTags(s.app, s.ana, s.anaId, ['mia']);
    await createWithTags(s.app, s.bob, s.bobId, ['suya', 'otra']);

    const ana = listTagsResponseSchema.parse((await get(s.app, '', s.ana)).body);
    const bob = listTagsResponseSchema.parse((await get(s.app, '', s.bob)).body);

    expect(ana.items).toEqual(['mia']);
    expect(bob.items).toEqual(['otra', 'suya']);
    expect(ana.total).toBe(1);
  });

  it('answers an invalid limit or offset with 400 VALIDATION_FAILED (FR-01)', async () => {
    const s = await setup();
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=',
      '?limit=abc',
      '?offset=-1',
      '?offset=',
      '?offset=1.5',
    ]) {
      const response = await get(s.app, query, s.ana);
      expect(response.status, query).toBe(400);
      expect(response.body, query).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('answers 401 without a session and 403 for an unverified user (FR-01)', async () => {
    const s = await setup();
    const anonymous = await get(s.app, '');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ code: 'UNAUTHENTICATED' });

    const email = `eve-${randomUUID()}@example.com`;
    await seedUser(connection, { email, password: PASSWORD, verified: false });
    const eve = sessionFrom(await signIn(s.app, email, PASSWORD));
    const unverified = await get(s.app, '', eve);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('answers 500 INTERNAL when a query fails with an error that echoes a tag name, and logs none (FR-01)', async () => {
    const stubbed = createDatabase(testDatabaseUrl);
    const echo = 'driver echo SecretTagName';
    // A PostgreSQL data exception (SQLSTATE 22xxx) is the real error that repeats request values.
    const dataException = (): Error =>
      Object.assign(new Error(echo), { code: '22P02', severity: 'ERROR' });
    Object.assign(stubbed.pool, {
      query: () => Promise.reject(dataException()),
      connect: () => Promise.reject(dataException()),
    });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [createTagRoutes({ db: stubbed.db })],
    });
    const email = `ana-${randomUUID()}@example.com`;
    await seedUser(connection, { email, password: PASSWORD });
    const ana = sessionFrom(await signIn(harness.app, email, PASSWORD));

    const response = await get(harness.app, '', ana);

    expect(response.status).toBe(500);
    expect(response.text).toBe('{"code":"INTERNAL"}');
    expect(harness.lines.some((line) => line.includes('"level":50'))).toBe(true);
    expect(harness.lines.join(' ')).not.toContain('SecretTagName');
    await stubbed.pool.end();
  });
});
