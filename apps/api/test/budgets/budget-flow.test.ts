import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory } from '../movements/db-fixtures';
import { addUser, buildApp, call, MovableClock } from './route-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const body = (categoryId: string, over: Record<string, unknown> = {}) => ({
  name: 'Groceries',
  amount: '1000',
  currency: 'ARS',
  categoryIds: [categoryId],
  ...over,
});

describe('budget flows', () => {
  it('keeps the previous month version and makes the new one current (AC-12)', async () => {
    const clock = new MovableClock(new Date('2026-09-15T16:00:00.000Z'));
    const { app } = buildApp(connection, clock);
    const ana = await addUser(connection, app, 'ana');
    const category = await newCategory(connection.pool, ana.id, 'expense');
    const created = await call(app, 'post', '/budgets', ana.cookies, body(category));
    expect(created.body.effectiveFrom).toBe('2026-09-01');

    clock.current = new Date('2026-10-15T16:00:00.000Z');
    const edited = await call(app, 'patch', `/budgets/${created.body.id}`, ana.cookies, {
      amount: '2000',
    });
    expect(edited.body).toMatchObject({ amount: '2000', effectiveFrom: '2026-10-01' });

    const versions = await connection.pool.query<{ effective_from: string; amount: string }>(
      `select to_char(effective_from, 'YYYY-MM-DD') as effective_from, amount::text
       from budget_versions where budget_id = $1 order by effective_from`,
      [created.body.id],
    );
    expect(versions.rows).toEqual([
      { effective_from: '2026-09-01', amount: '1000' },
      { effective_from: '2026-10-01', amount: '2000' },
    ]);
  });

  it('answers 409 on the 51st budget and accepts one again after a delete (AC-23, AC-24)', async () => {
    const { app } = buildApp(connection);
    const ana = await addUser(connection, app, 'ana');
    const category = await newCategory(connection.pool, ana.id, 'expense');
    let first = '';
    for (let i = 0; i < 50; i += 1) {
      const response = await call(app, 'post', '/budgets', ana.cookies, body(category));
      expect(response.status).toBe(201);
      if (i === 0) first = response.body.id;
    }
    const over = await call(app, 'post', '/budgets', ana.cookies, body(category));
    expect(over.status).toBe(409);
    expect(over.body.error?.code ?? over.body.code).toBe('BUDGET_LIMIT_REACHED');

    expect((await call(app, 'delete', `/budgets/${first}`, ana.cookies)).status).toBe(204);
    expect((await call(app, 'post', '/budgets', ana.cookies, body(category))).status).toBe(201);
  });

  it('shows a subcategory created after the budget in coveredCategoryIds (AC-06)', async () => {
    const { app } = buildApp(connection);
    const ana = await addUser(connection, app, 'ana');
    const parent = await newCategory(connection.pool, ana.id, 'expense');
    const created = await call(app, 'post', '/budgets', ana.cookies, body(parent));
    expect(created.body.coveredCategoryIds).toEqual([parent]);

    const child = await connection.pool.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color, parent_id)
       values ($1, 'expense', 'Child cat', 'wallet', 'blue', $2) returning id`,
      [ana.id, parent],
    );
    const childId = child.rows[0]?.id ?? '';
    const read = await call(app, 'get', `/budgets/${created.body.id}`, ana.cookies);
    expect([...read.body.coveredCategoryIds].sort()).toEqual([parent, childId].sort());
    expect(read.body.categoryIds).toEqual([parent]);
  });

  it('serves a budget created through another API instance (stateless)', async () => {
    const first = buildApp(connection);
    const second = buildApp(connection);
    const ana = await addUser(connection, first.app, 'ana');
    const category = await newCategory(connection.pool, ana.id, 'expense');
    const created = await call(first.app, 'post', '/budgets', ana.cookies, body(category));
    expect(created.status).toBe(201);
    // Both instances share the database, so the session cookie is valid on the second one.
    const read = await call(second.app, 'get', `/budgets/${created.body.id}`, ana.cookies);
    expect(read.status).toBe(200);
    expect(read.body.id).toBe(created.body.id);
  });

  it('keeps both fields when two partial edits of one budget run concurrently', async () => {
    const clock = new MovableClock(new Date('2026-09-15T16:00:00.000Z'));
    const { app } = buildApp(connection, clock);
    const ana = await addUser(connection, app, 'ana');
    const category = await newCategory(connection.pool, ana.id, 'expense');
    clock.current = new Date('2026-10-15T16:00:00.000Z');

    for (let round = 0; round < 5; round += 1) {
      const created = await call(app, 'post', '/budgets', ana.cookies, body(category));
      const path = `/budgets/${created.body.id}`;
      const [renamed, resized] = await Promise.all([
        call(app, 'patch', path, ana.cookies, { name: `Renamed ${round}` }),
        call(app, 'patch', path, ana.cookies, { amount: '2000' }),
      ]);
      expect([renamed.status, resized.status]).toEqual([200, 200]);

      const final = await call(app, 'get', path, ana.cookies);
      expect(final.body).toMatchObject({ name: `Renamed ${round}`, amount: '2000' });
    }
  });
});
