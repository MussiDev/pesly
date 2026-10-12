import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes } from '../../src/movements';
import type { ExpenseSavedHook } from '../../src/movements/application/ports/expense-saved-listener';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
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
const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });

async function setup(expenseSaved?: ExpenseSavedHook) {
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createMovementRoutes({
        db: connection.db,
        logger,
        ...(expenseSaved === undefined ? {} : { expenseSaved }),
      }),
    ],
  });
  const email = `ana-${randomUUID()}@example.com`;
  const userId = await seedUser(connection, { email, password: PASSWORD });
  const cookies = cookieHeader(sessionFrom(await signIn(harness.app, email, PASSWORD)));
  const accountId = await newAccount(connection.pool, userId);
  const categoryId = await newCategory(connection.pool, userId, 'expense');
  const body = (amount: string) => ({
    type: 'expense',
    accountId,
    categoryId,
    amount,
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    rate: { source: 'manual', value: '14000000' },
  });
  return { app: harness.app, cookies, userId, categoryId, body };
}

describe('movement routes and the expense saved hook', () => {
  it('calls the hook once on POST and once on PUT with the owner and category (AC-06)', async () => {
    const calls: { userId: string; categoryId: string }[] = [];
    const s = await setup({
      run: (scope, event) => {
        calls.push({ userId: scope.userId, categoryId: event.categoryId });
        return Promise.resolve();
      },
    });

    const created = await request(s.app)
      .post('/movements')
      .set(trustedHeaders)
      .set('Cookie', s.cookies)
      .send(s.body('1000'));
    expect(created.status).toBe(201);
    expect(calls).toEqual([{ userId: s.userId, categoryId: s.categoryId }]);

    const edited = await request(s.app)
      .put(`/movements/${(created.body as { id: string }).id}`)
      .set(trustedHeaders)
      .set('Cookie', s.cookies)
      .send({ ...s.body('2000'), rate: { source: 'keep' } });
    expect(edited.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('behaves as before with no hook (AC-06)', async () => {
    const s = await setup();

    const created = await request(s.app)
      .post('/movements')
      .set(trustedHeaders)
      .set('Cookie', s.cookies)
      .send(s.body('1000'));

    expect(created.status).toBe(201);
  });

  it('does not call the hook for a request with no session (AC-19)', async () => {
    let called = 0;
    const s = await setup({
      run: () => {
        called += 1;
        return Promise.resolve();
      },
    });

    const response = await request(s.app).post('/movements').set(trustedHeaders).send(s.body('1'));

    expect(response.status).toBe(401);
    expect(called).toBe(0);
  });
});
