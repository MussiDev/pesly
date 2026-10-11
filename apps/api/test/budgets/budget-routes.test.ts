import { budgetListResponseSchema, budgetResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory } from '../movements/db-fixtures';
import { addUser, buildApp, call } from './route-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function setup() {
  const { app, lines } = buildApp(connection);
  const ana = await addUser(connection, app, 'ana');
  const bob = await addUser(connection, app, 'bob');
  const eve = await addUser(connection, app, 'eve', { verified: false });
  const category = await newCategory(connection.pool, ana.id, 'expense');
  return { app, lines, ana, bob, eve, category };
}

const body = (categoryId: string, over: Record<string, unknown> = {}) => ({
  name: 'Groceries',
  amount: '15000000',
  currency: 'ARS',
  categoryIds: [categoryId],
  ...over,
});

const codeOf = (response: { body: { error?: { code?: string }; code?: string } }) =>
  response.body.error?.code ?? response.body.code;

describe('budget routes', () => {
  it('creates, lists, reads, edits and deletes a budget with the contract shape (AC-01, AC-17, AC-21)', async () => {
    const s = await setup();
    const created = await call(s.app, 'post', '/budgets', s.ana.cookies, body(s.category));
    expect(created.status).toBe(201);
    const budget = budgetResponseSchema.parse(created.body);
    expect(budget).toMatchObject({
      name: 'Groceries',
      amount: '15000000',
      currency: 'ARS',
      rollover: false,
      thresholds: [80, 100],
      categoryIds: [s.category],
    });
    expect(typeof created.body.amount).toBe('string');

    const list = budgetListResponseSchema.parse(
      (await call(s.app, 'get', '/budgets', s.ana.cookies)).body,
    );
    expect(list.map((b) => b.id)).toEqual([budget.id]);

    const read = await call(s.app, 'get', `/budgets/${budget.id}`, s.ana.cookies);
    expect(read.status).toBe(200);
    expect(budgetResponseSchema.parse(read.body).id).toBe(budget.id);

    const edited = await call(s.app, 'patch', `/budgets/${budget.id}`, s.ana.cookies, {
      amount: '20000000',
      rollover: true,
    });
    expect(edited.status).toBe(200);
    expect(budgetResponseSchema.parse(edited.body)).toMatchObject({
      name: 'Groceries',
      amount: '20000000',
      rollover: true,
    });

    expect((await call(s.app, 'delete', `/budgets/${budget.id}`, s.ana.cookies)).status).toBe(204);
    expect((await call(s.app, 'get', `/budgets/${budget.id}`, s.ana.cookies)).status).toBe(404);
  });

  it.each([
    ['no category', { categoryIds: [] }],
    ['zero amount', { amount: '0' }],
    ['empty name', { name: '' }],
    ['bad currency', { currency: 'EUR' }],
    ['extra key', { ownerId: 'x' }],
    ['decimal amount', { amount: '10.5' }],
  ])('rejects a create body with %s (AC-02, AC-15)', async (_label, over) => {
    const s = await setup();
    const response = await call(s.app, 'post', '/budgets', s.ana.cookies, body(s.category, over));
    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('VALIDATION_FAILED');
  });

  it.each([[[0]], [[201]], [[80, 80]], [[1, 2, 3, 4, 5, 6]]])(
    'rejects thresholds %j (AC-11, AC-22)',
    async (thresholds) => {
      const s = await setup();
      const response = await call(
        s.app,
        'post',
        '/budgets',
        s.ana.cookies,
        body(s.category, { thresholds }),
      );
      expect(response.status).toBe(400);
    },
  );

  it('accepts five thresholds and sorts them (AC-22)', async () => {
    const s = await setup();
    const response = await call(
      s.app,
      'post',
      '/budgets',
      s.ana.cookies,
      body(s.category, { thresholds: [100, 50, 10, 150, 200] }),
    );
    expect(response.status).toBe(201);
    expect(response.body.thresholds).toEqual([10, 50, 100, 150, 200]);
  });

  it('answers 404, 400 and 409 for foreign, income and archived categories (AC-03, AC-04, AC-05, AC-16)', async () => {
    const s = await setup();
    const foreign = await newCategory(connection.pool, s.bob.id, 'expense');
    const income = await newCategory(connection.pool, s.ana.id, 'income');
    const archived = await newCategory(connection.pool, s.ana.id, 'expense', true);
    const created = await call(s.app, 'post', '/budgets', s.ana.cookies, body(s.category));

    for (const [id, status, code] of [
      [foreign, 404, 'NOT_FOUND'],
      [income, 400, 'BUDGET_CATEGORY_KIND_INVALID'],
      [archived, 409, 'CATEGORY_ARCHIVED'],
    ] as const) {
      const onCreate = await call(s.app, 'post', '/budgets', s.ana.cookies, body(id));
      expect(onCreate.status).toBe(status);
      expect(codeOf(onCreate)).toBe(code);
      const onEdit = await call(s.app, 'patch', `/budgets/${created.body.id}`, s.ana.cookies, {
        categoryIds: [id],
      });
      expect(onEdit.status).toBe(status);
    }
  });

  it('answers a foreign budget exactly like an unknown id and leaves it unchanged (AC-18, AC-19)', async () => {
    const s = await setup();
    const created = await call(s.app, 'post', '/budgets', s.ana.cookies, body(s.category));
    const id = created.body.id;
    const unknown = '00000000-0000-4000-8000-000000000000';

    for (const method of ['get', 'patch', 'delete'] as const) {
      const payload = method === 'patch' ? { name: 'Hacked' } : undefined;
      const foreign = await call(s.app, method, `/budgets/${id}`, s.bob.cookies, payload);
      const missing = await call(s.app, method, `/budgets/${unknown}`, s.bob.cookies, payload);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
    }
    const after = await call(s.app, 'get', `/budgets/${id}`, s.ana.cookies);
    expect(after.body).toEqual(created.body);
    expect((await call(s.app, 'get', '/budgets', s.bob.cookies)).body).toEqual([]);
  });

  it('answers 401 without a session and leaks no budget field (AC-20)', async () => {
    const s = await setup();
    const response = await call(s.app, 'get', '/budgets');
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('amount');
    expect(response.body).not.toHaveProperty('name');
    expect((await call(s.app, 'post', '/budgets', undefined, body(s.category))).status).toBe(401);
  });

  it('answers 403 EMAIL_NOT_VERIFIED to an unverified user', async () => {
    const s = await setup();
    const response = await call(s.app, 'get', '/budgets', s.eve.cookies);
    expect(response.status).toBe(403);
    expect(codeOf(response)).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects an empty edit, a currency change and a malformed id', async () => {
    const s = await setup();
    const created = await call(s.app, 'post', '/budgets', s.ana.cookies, body(s.category));
    for (const patch of [{}, { currency: 'USD' }]) {
      const response = await call(
        s.app,
        'patch',
        `/budgets/${created.body.id}`,
        s.ana.cookies,
        patch,
      );
      expect(response.status).toBe(400);
    }
    expect((await call(s.app, 'get', '/budgets/not-a-uuid', s.ana.cookies)).status).toBe(400);
  });

  it('logs ids only, never a budget name or amount', async () => {
    const s = await setup();
    const created = await call(
      s.app,
      'post',
      '/budgets',
      s.ana.cookies,
      body(s.category, { name: 'Secret Stash', amount: '73519242' }),
    );
    await call(s.app, 'patch', `/budgets/${created.body.id}`, s.ana.cookies, {
      name: 'Other Secret',
      amount: '84620353',
    });
    await call(s.app, 'delete', `/budgets/${created.body.id}`, s.ana.cookies);
    const logged = s.lines.join('\n');
    expect(logged).toContain(created.body.id);
    for (const secret of ['Secret Stash', 'Other Secret', '73519242', '84620353']) {
      expect(logged).not.toContain(secret);
    }
  });
});
