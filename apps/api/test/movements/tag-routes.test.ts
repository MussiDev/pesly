import { randomUUID } from 'node:crypto';
import { tagSuggestionsResponseSchema } from '@pesly/shared';
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
      createTagRoutes({ db: connection.db, logger }),
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
