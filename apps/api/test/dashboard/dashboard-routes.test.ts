import { dashboardResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { addUser, buildApp, get } from './route-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('GET /dashboard', () => {
  it('answers 200 with a body that parses for a verified session', async () => {
    const { app, scopes } = buildApp(connection);
    const ana = await addUser(connection, app, 'ana');

    const response = await get(app, '/dashboard', { cookies: ana.cookies });

    expect(response.status).toBe(200);
    expect(dashboardResponseSchema.safeParse(response.body).success).toBe(true);
    expect(scopes).toHaveLength(1);
  });

  it('answers 400 VALIDATION_FAILED for any query parameter and never calls the use case', async () => {
    const { app, scopes } = buildApp(connection);
    const ana = await addUser(connection, app, 'ana');

    for (const query of ['?from=2026-10-01', '?x=1', '?q=']) {
      const response = await get(app, `/dashboard${query}`, { cookies: ana.cookies });
      expect(response.status, query).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.netWorth).toBeUndefined();
    }
    expect(scopes).toHaveLength(0);
  });

  it('answers 401 with no session and calls no use case', async () => {
    const { app, scopes } = buildApp(connection);

    const response = await get(app, '/dashboard');

    expect(response.status).toBe(401);
    expect(response.body.netWorth).toBeUndefined();
    expect(scopes).toHaveLength(0);
  });

  it('answers 403 EMAIL_NOT_VERIFIED for an unverified email', async () => {
    const { app, scopes } = buildApp(connection);
    const eve = await addUser(connection, app, 'eve', { verified: false });

    const response = await get(app, '/dashboard', { cookies: eve.cookies });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(response.body.netWorth).toBeUndefined();
    expect(scopes).toHaveLength(0);
  });

  it('hands the use case the scope of the caller and ignores a user id in a header or query', async () => {
    const { app, scopes } = buildApp(connection);
    const ana = await addUser(connection, app, 'ana');
    const bea = await addUser(connection, app, 'bea');

    await get(app, '/dashboard', {
      cookies: ana.cookies,
      headers: { 'x-test-user-id': bea.id, 'x-user-id': bea.id },
    });
    await get(app, `/dashboard?userId=${bea.id}`, { cookies: ana.cookies });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.userId).toBe(ana.id);
  });

  it('answers the standard 500 with no stack and no section when the use case fails', async () => {
    const { app } = buildApp(connection, () => Promise.reject(new Error('boom: select 1')));
    const ana = await addUser(connection, app, 'ana');

    const response = await get(app, '/dashboard', { cookies: ana.cookies });

    expect(response.status).toBe(500);
    expect(response.body.netWorth).toBeUndefined();
    expect(response.body.stack).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('boom');
  });
});
