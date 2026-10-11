import { readFile } from 'node:fs/promises';
import { goalResponseSchema, listGoalsResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseUserGoals } from '../../src/goals';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';
import { call, createAccount, goalsSetup } from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('goal flow', () => {
  it('a second API instance sees a goal created through the first (stateless)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const created = await call(s.app, 'post', '/goals', ana.cookies, {
      name: 'Car',
      targetAmount: '500000',
      currency: 'ARS',
    });
    expect(created.status).toBe(201);
    const id = goalResponseSchema.parse(created.body).id;

    const second = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: s.routerFactories(),
    });
    const listed = await call(second.app, 'get', '/goals', ana.cookies);
    expect(listed.status).toBe(200);
    expect(listGoalsResponseSchema.parse(listed.body).goals.map((goal) => goal.id)).toEqual([id]);
  });

  it('erases a user with a linked goal through eraseUserGoals', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const account = await createAccount(s, ana, 'ARS', '1000');
    const created = await call(s.app, 'post', '/goals', ana.cookies, {
      name: 'Car',
      targetAmount: '500000',
      currency: 'ARS',
      accountId: account,
    });
    expect(created.status).toBe(201);

    const result = await new DrizzleUserDeletionRepository(connection.db, [eraseUserGoals]).erase({
      userId: ana.id,
      credentialsVersion: 0,
    });

    expect(result).toBe('erased');
    const left = await connection.pool.query(
      'select (select count(*) from goals where owner_id = $1)::int as goals, (select count(*) from accounts where owner_id = $1)::int as accounts',
      [ana.id],
    );
    expect(left.rows[0]).toEqual({ goals: 0, accounts: 0 });
  });

  it('the composition root mounts createGoalRoutes and runs eraseUserGoals after eraseUserRecurring (D13)', async () => {
    const source = await readFile(new URL('../../src/server.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/createGoalRoutes\(\{[^}]*movements:\s*createAccountMovements\(db\)/);
    expect(source).toMatch(/beforeUserErased:\s*\[\s*eraseUserRecurring,\s*eraseUserGoals,/);
  });
});
