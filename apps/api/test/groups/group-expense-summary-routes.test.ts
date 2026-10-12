import { randomUUID } from 'node:crypto';
import { groupExpenseSummaryResponseSchema } from '@pesly/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleGroupExpenseSummaryReader } from '../../src/groups/infrastructure/db/drizzle-group-expense-summary-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { call, createGroup, readGroup, setupGroupApi, type TestUser } from './routes-harness';
import type { DbWorld } from './settlement-db-world';
import { addCategory, seedExpenses } from './summary-db-seed';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FROM = '2026-10-01T03:00:00.000Z';
const TO = '2026-10-31T02:59:59.999Z';
const INSIDE = new Date('2026-10-15T12:00:00.000Z');
const QUERY = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

async function world() {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const group = await createGroup(api.app, ana);
  const detail = await readGroup(api.app, ana, group.id);
  const categories = await connection.pool.query<{ id: string }>(
    'select id from group_categories where group_id = $1 order by created_at, id',
    [group.id],
  );
  const seedWorld: DbWorld = {
    userId: ana.id,
    groupId: group.id,
    anaMember: detail.members[0]?.id ?? '',
    memberIds: detail.members.map((m) => m.id),
    categoryId: categories.rows[0]?.id ?? '',
  };
  return { api, ana, groupId: group.id, seedWorld, categoryIds: categories.rows.map((r) => r.id) };
}

function summaryPath(groupId: string, query = QUERY): string {
  return `/groups/${groupId}/expenses/summary?${query}`;
}

describe('GET /groups/:id/expenses/summary', () => {
  it('answers 200 with string sums per currency, each with its own lines, and the categories named (AC-26, AC-13)', async () => {
    const w = await world();
    const [a = '', b = '', c = ''] = w.categoryIds;
    await seedExpenses(connection.pool, w.seedWorld, [
      { currency: 'ARS', categoryId: a, amount: 1_000n, occurredAt: INSIDE },
      { currency: 'ARS', categoryId: a, amount: 500n, occurredAt: INSIDE },
      { currency: 'ARS', categoryId: b, amount: 1_500n, occurredAt: INSIDE },
      { currency: 'USD', categoryId: c, amount: 7_000n, occurredAt: INSIDE },
    ]);

    const response = await call(w.api.app, 'get', summaryPath(w.groupId), w.ana.cookies);

    expect(response.status).toBe(200);
    const body = groupExpenseSummaryResponseSchema.parse(response.body);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(TO);
    expect(body.currencies.map((entry) => entry.currency)).toEqual(['ARS', 'USD']);
    const [ars, usd] = body.currencies;
    expect(ars).toMatchObject({ total: '3000', count: 3 });
    expect(ars?.categories).toEqual(
      [
        { categoryId: a, total: '1500', count: 2 },
        { categoryId: b, total: '1500', count: 1 },
      ].sort((x, y) => (x.categoryId < y.categoryId ? -1 : 1)),
    );
    expect(usd).toEqual({
      currency: 'USD',
      total: '7000',
      count: 1,
      categories: [{ categoryId: c, total: '7000', count: 1 }],
    });
    expect(body.categories.map((category) => category.id).sort()).toEqual([a, b, c].sort());
  });

  it('keeps the line of an archived category and lists it with archivedAt set (AC-18)', async () => {
    const w = await world();
    const archived = await addCategory(connection.pool, w.groupId, 'Vieja');
    await connection.pool.query('update group_categories set archived_at = now() where id = $1', [
      archived,
    ]);
    await seedExpenses(connection.pool, w.seedWorld, [
      { currency: 'ARS', categoryId: archived, amount: 40n, occurredAt: INSIDE },
    ]);

    const body = groupExpenseSummaryResponseSchema.parse(
      (await call(w.api.app, 'get', summaryPath(w.groupId), w.ana.cookies)).body,
    );

    expect(body.currencies[0]?.categories).toEqual([
      { categoryId: archived, total: '40', count: 1 },
    ]);
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]?.archivedAt).not.toBeNull();
  });

  it('reflects an edited and a deleted expense in the next response (AC-29)', async () => {
    const w = await world();
    const a = w.categoryIds[0] ?? '';
    await seedExpenses(connection.pool, w.seedWorld, [
      { currency: 'ARS', categoryId: a, amount: 100n, occurredAt: INSIDE },
      { currency: 'ARS', categoryId: a, amount: 200n, occurredAt: INSIDE },
    ]);
    const read = async () =>
      groupExpenseSummaryResponseSchema.parse(
        (await call(w.api.app, 'get', summaryPath(w.groupId), w.ana.cookies)).body,
      ).currencies[0];
    expect(await read()).toMatchObject({ total: '300', count: 2 });

    await connection.pool.query(
      'update group_expenses set amount = 150 where group_id = $1 and amount = 100',
      [w.groupId],
    );
    expect(await read()).toMatchObject({ total: '350', count: 2 });

    await connection.pool.query('delete from group_expenses where group_id = $1 and amount = 200', [
      w.groupId,
    ]);
    expect(await read()).toMatchObject({ total: '150', count: 1 });
  });

  it('returns an empty currency list for a group without expenses in the range (AC-16)', async () => {
    const w = await world();

    const response = await call(w.api.app, 'get', summaryPath(w.groupId), w.ana.cookies);

    expect(response.status).toBe(200);
    expect(groupExpenseSummaryResponseSchema.parse(response.body).currencies).toEqual([]);
  });

  it.each([
    ['a reversed range', `from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`],
    [
      'a 367-day range',
      `from=${encodeURIComponent('2025-01-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-01-03T00:00:00.000Z')}`,
    ],
    ['a missing from', `to=${encodeURIComponent(TO)}`],
    ['a missing to', `from=${encodeURIComponent(FROM)}`],
    ['an extra key', `${QUERY}&extra=1`],
  ])('answers 400 to %s and never reads (AC-27)', async (_name, query) => {
    const w = await world();
    const spy = vi.spyOn(DrizzleGroupExpenseSummaryReader.prototype, 'summarize');

    const response = await call(w.api.app, 'get', summaryPath(w.groupId, query), w.ana.cookies);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('VALIDATION_FAILED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 400 to a group id that is not a UUID and never reads (AC-27)', async () => {
    const w = await world();
    const spy = vi.spyOn(DrizzleGroupExpenseSummaryReader.prototype, 'summarize');

    const response = await call(w.api.app, 'get', summaryPath('nope'), w.ana.cookies);

    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 404 with the same body to a non-member and to an unknown group (AC-28, NFR-06)', async () => {
    const w = await world();
    const outsider: TestUser = await w.api.makeUser('eve');
    await seedExpenses(connection.pool, w.seedWorld, [
      { currency: 'ARS', categoryId: w.categoryIds[0] ?? '', amount: 9n, occurredAt: INSIDE },
    ]);

    const stranger = await call(w.api.app, 'get', summaryPath(w.groupId), outsider.cookies);
    const unknown = await call(w.api.app, 'get', summaryPath(randomUUID()), outsider.cookies);

    expect(stranger.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stranger.body).toEqual(unknown.body);
  });

  it('answers 401 without a session', async () => {
    const w = await world();

    const response = await call(w.api.app, 'get', summaryPath(w.groupId));

    expect(response.status).toBe(401);
  });

  it('is served by the summary route, not by the expense id route', async () => {
    const w = await world();

    const response = await call(w.api.app, 'get', summaryPath(w.groupId), w.ana.cookies);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('currencies');
  });
});
