import { budgetSpendingListResponseSchema, budgetSpendingResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BudgetVersionReader,
  BudgetVersions,
} from '../../src/budgets/application/ports/budget-version-reader';
import type {
  BucketedPersonalRow,
  SpendingReader,
} from '../../src/budgets/application/ports/spending-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { addUser, buildApp, call } from './route-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const FOOD = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';
const BUDGET_ID = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
const UNKNOWN = '55555555-5555-4555-8555-555555555555';

function monthVersions(months: readonly string[]): BudgetVersions {
  const inForce = {
    version: {
      effectiveFrom: '2026-10-01',
      name: 'Groceries',
      amount: 15000000n,
      rollover: false,
      categoryIds: [FOOD],
      thresholds: [80, 100],
    },
    covered: [{ id: FOOD, name: 'Food', defaultKey: null }],
  };
  return {
    budgetId: BUDGET_ID,
    currency: 'ARS',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    // Only October has a version in force; any earlier month is before the budget existed.
    byMonth: new Map(months.map((month) => [month, month === '2026-10' ? inForce : null])),
  };
}

/** Scripted readers: the budget belongs to `ownerId` only, and every read is counted. */
function readers(ownerId: string, sum: bigint) {
  const calls = { versions: 0, spending: 0 };
  const versionReader: BudgetVersionReader = {
    forMonths(scope, months, budgetId) {
      calls.versions += 1;
      const mine = scope.userId === ownerId && (budgetId === undefined || budgetId === BUDGET_ID);
      return Promise.resolve(mine ? [monthVersions(months)] : []);
    },
  };
  const spendingReader: SpendingReader = {
    personalSpending() {
      calls.spending += 1;
      const row: BucketedPersonalRow = {
        bucket: 'current',
        categoryId: FOOD,
        currency: 'ARS',
        rate: 15000000n,
        sum,
        count: 1,
      };
      return Promise.resolve([row]);
    },
    shareSpending() {
      calls.spending += 1;
      return Promise.resolve([]);
    },
  };
  return { calls, versionReader, spendingReader };
}

async function setup(sum = 12000000n) {
  // Resolved after the users exist: the scripted budget belongs to the first one.
  const probe = buildApp(connection);
  const ana = await addUser(connection, probe.app, 'ana');
  const fake = readers(ana.id, sum);
  const { app, lines } = buildApp(connection, undefined, {
    readers: { versionReader: fake.versionReader, spendingReader: fake.spendingReader },
  });
  const bob = await addUser(connection, app, 'bob');
  const eve = await addUser(connection, app, 'eve', { verified: false });
  return { app, lines, ana, bob, eve, calls: fake.calls };
}

const codeOf = (response: { body: { error?: { code?: string }; code?: string } }) =>
  response.body.error?.code ?? response.body.code;

describe('budget spending routes', () => {
  it('lists the spending with the contract shape, before /budgets/:id (AC-01, AC-13)', async () => {
    const s = await setup();
    const response = await call(s.app, 'get', '/budgets/spending', s.ana.cookies);
    expect(response.status).toBe(200);
    const list = budgetSpendingListResponseSchema.parse(response.body);
    expect(list.month).toBe('2026-10');
    expect(list.budgets).toHaveLength(1);
    expect(list.budgets[0]).toMatchObject({
      budgetId: BUDGET_ID,
      name: 'Groceries',
      amount: '15000000',
      rolloverAmount: '0',
      available: '15000000',
      spent: '12000000',
      remaining: '3000000',
      percentUsed: 80,
      thresholds: [80, 100],
      unconvertedShareCount: 0,
    });
  });

  it('reads one budget with a signed remaining when overspent (AC-14)', async () => {
    const s = await setup(18000000n);
    const response = await call(
      s.app,
      'get',
      `/budgets/${BUDGET_ID}/spending?month=2026-10`,
      s.ana.cookies,
    );
    expect(response.status).toBe(200);
    expect(budgetSpendingResponseSchema.parse(response.body)).toMatchObject({
      remaining: '-3000000',
      percentUsed: 120,
    });
  });

  it('rejects a malformed month and an unknown key with VALIDATION_FAILED (AC-16)', async () => {
    const s = await setup();
    for (const query of ['month=2026-13', 'month=2026-1', 'month=', 'other=1']) {
      const list = await call(s.app, 'get', `/budgets/spending?${query}`, s.ana.cookies);
      expect([list.status, codeOf(list)]).toEqual([400, 'VALIDATION_FAILED']);
      const one = await call(
        s.app,
        'get',
        `/budgets/${BUDGET_ID}/spending?${query}`,
        s.ana.cookies,
      );
      expect([one.status, codeOf(one)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(s.calls.versions).toBe(0);
  });

  it('rejects a malformed id with VALIDATION_FAILED', async () => {
    const s = await setup();
    const response = await call(s.app, 'get', '/budgets/not-a-uuid/spending', s.ana.cookies);
    expect([response.status, codeOf(response)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('rejects a future month with BUDGET_MONTH_IN_FUTURE and reads nothing (AC-16)', async () => {
    const s = await setup();
    const list = await call(s.app, 'get', '/budgets/spending?month=2026-11', s.ana.cookies);
    expect([list.status, codeOf(list)]).toEqual([400, 'BUDGET_MONTH_IN_FUTURE']);
    const one = await call(
      s.app,
      'get',
      `/budgets/${BUDGET_ID}/spending?month=2030-01`,
      s.ana.cookies,
    );
    expect([one.status, codeOf(one)]).toEqual([400, 'BUDGET_MONTH_IN_FUTURE']);
    expect(s.calls.versions + s.calls.spending).toBe(0);
  });

  it('answers 404 for a foreign and an unknown budget with the same body (AC-23, AC-24)', async () => {
    const s = await setup();
    const foreign = await call(s.app, 'get', `/budgets/${BUDGET_ID}/spending`, s.bob.cookies);
    const unknown = await call(s.app, 'get', `/budgets/${UNKNOWN}/spending`, s.ana.cookies);
    expect([foreign.status, codeOf(foreign)]).toEqual([404, 'NOT_FOUND']);
    expect(unknown.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    expect(s.calls.spending).toBe(0);

    const bobList = await call(s.app, 'get', '/budgets/spending', s.bob.cookies);
    expect(budgetSpendingListResponseSchema.parse(bobList.body).budgets).toEqual([]);
  });

  it('answers 401 with no session and leaks no budget field (AC-25)', async () => {
    const s = await setup();
    for (const path of ['/budgets/spending', `/budgets/${BUDGET_ID}/spending`]) {
      const response = await call(s.app, 'get', path);
      expect([response.status, codeOf(response)]).toEqual([401, 'UNAUTHENTICATED']);
      expect(JSON.stringify(response.body)).not.toContain('Groceries');
    }
  });

  it('answers 403 for an unverified email', async () => {
    const s = await setup();
    const response = await call(s.app, 'get', '/budgets/spending', s.eve.cookies);
    expect([response.status, codeOf(response)]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
  });

  it('logs ids only, never a name or an amount', async () => {
    const s = await setup();
    await call(s.app, 'get', `/budgets/${BUDGET_ID}/spending`, s.ana.cookies);
    const joined = s.lines.join('\n');
    expect(joined).not.toContain('Groceries');
    expect(joined).not.toContain('12000000');
  });
});
