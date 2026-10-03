import { randomUUID } from 'node:crypto';
import {
  listMovementsResponseSchema,
  movementResponseSchema,
  tagSuggestionsResponseSchema,
} from '@pesly/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes, createTagRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory } from './db-fixtures';

// R-04: a valid 24-character tag made of SQL metacharacters must travel as data on every path.
const PAYLOAD = "x'); drop table tags; --";
const PASSWORD = 'a long enough passphrase';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function setup() {
  const logger = createLogger({ level: 'debug', destination: { write: () => undefined } });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createMovementRoutes({ db: connection.db, logger }),
      createTagRoutes({ db: connection.db }),
    ],
  });
  const email = `sql-${randomUUID()}@example.com`;
  const ownerId = await seedUser(connection, { email, password: PASSWORD });
  const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
  const accountId = await newAccount(connection.pool, ownerId);
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  const create = (tags: string[]) =>
    request(harness.app)
      .post('/movements')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(cookies))
      .send({
        type: 'expense',
        accountId,
        categoryId,
        amount: '1000',
        occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
        rate: { source: 'manual', value: '14000000' },
        tags,
      });
  const get = (path: string) => request(harness.app).get(path).set('Cookie', cookieHeader(cookies));
  return { ownerId, create, get };
}

async function rowCount(table: 'tags' | 'movements', ownerId: string): Promise<number> {
  // Selecting from the table also proves it still exists.
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe('SQL metacharacters as tag data (R-04)', () => {
  it('POST /movements stores the payload tag literally and keeps the tables', async () => {
    const s = await setup();
    const response = await s.create([PAYLOAD]);

    expect(response.status).toBe(201);
    expect(movementResponseSchema.parse(response.body).tags).toEqual([PAYLOAD]);
    const stored = await connection.pool.query<{ name: string }>(
      'select name from tags where owner_id = $1',
      [s.ownerId],
    );
    expect(stored.rows.map((row) => row.name)).toEqual([PAYLOAD]);
    expect(await rowCount('movements', s.ownerId)).toBe(1);
  });

  it('GET /movements?tag=payload finds only the movement carrying it', async () => {
    const s = await setup();
    const carrier = movementResponseSchema.parse((await s.create([PAYLOAD])).body);
    await s.create(['x']);
    await s.create([]);

    const response = await s.get(`/movements?${new URLSearchParams({ tag: PAYLOAD }).toString()}`);

    expect(response.status).toBe(200);
    const page = listMovementsResponseSchema.parse(response.body);
    expect(page.items.map((item) => item.id)).toEqual([carrier.id]);
    expect(page.total).toBe(1);
    expect(await rowCount('tags', s.ownerId)).toBe(2);
    expect(await rowCount('movements', s.ownerId)).toBe(3);
  });

  it('GET /tags?prefix=payload suggests exactly the payload and keeps the tables', async () => {
    const s = await setup();
    await s.create([PAYLOAD, 'x', 'xylophone']);

    const response = await s.get(`/tags?${new URLSearchParams({ prefix: PAYLOAD }).toString()}`);

    expect(response.status).toBe(200);
    expect(tagSuggestionsResponseSchema.parse(response.body).items).toEqual([PAYLOAD]);
    expect(await rowCount('tags', s.ownerId)).toBe(3);
  });

  it('LIKE wildcards in a prefix are data, not patterns', async () => {
    const s = await setup();
    await s.create(['abc', '100%']);

    const response = await s.get(`/tags?${new URLSearchParams({ prefix: '%' }).toString()}`);

    expect(tagSuggestionsResponseSchema.parse(response.body).items).toEqual([]);
  });
});
