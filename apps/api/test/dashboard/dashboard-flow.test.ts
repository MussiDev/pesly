import { dashboardResponseSchema, type DashboardResponse } from '@pesly/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleFlowReader } from '../../src/reports';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { addRealUser, buildRealApp, getJson } from './real-app';
import { seedGroup, seedRate, seedWorld } from './world-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await connection.pool.end();
});

const AMOUNT_KEYS = new Set([
  'ars',
  'usd',
  'total',
  'expenses',
  'income',
  'net',
  'amount',
  'available',
  'spent',
]);
const INTEGER_STRING = /^-?\d+$/;

/** Every amount-like field of the response, wherever it sits. */
function amountFields(value: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => amountFields(item, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path === '' ? key : `${path}.${key}`;
    // The three changes are whole percentages, not amounts.
    // `available` is also the key of the available section: only its leaves are amounts.
    const isAmount =
      AMOUNT_KEYS.has(key) &&
      child !== null &&
      typeof child !== 'object' &&
      !here.startsWith('month.change');
    const own: [string, unknown][] = isAmount ? [[here, child]] : [];
    return [...own, ...amountFields(child, here)];
  });
}

async function dashboardOf(
  app: Parameters<typeof getJson>[0],
  cookies: Parameters<typeof getJson>[2],
): Promise<DashboardResponse> {
  const response = await getJson(app, '/dashboard', cookies);
  expect(response.status).toBe(200);
  return dashboardResponseSchema.parse(response.body);
}

describe('GET /dashboard over the real routes and PostgreSQL', () => {
  it('(AC-02) answers 400 with no data for a query parameter', async () => {
    const { app } = buildRealApp(connection);
    const ana = await addRealUser(connection, app, 'ana');

    const response = await getJson(app, '/dashboard?from=2026-10-01', ana.cookies);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(response.text).not.toContain('netWorth');
  });

  it('(AC-44, AC-46) answers 401 without a session and 403 for an unverified email', async () => {
    const { app } = buildRealApp(connection);
    const eve = await addRealUser(connection, app, 'eve', { verified: false });

    const anonymous = await getJson(app, '/dashboard');
    const unverified = await getJson(app, '/dashboard', eve.cookies);

    expect(anonymous.status).toBe(401);
    expect(anonymous.text).not.toContain('netWorth');
    expect(unverified.status).toBe(403);
    expect(unverified.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(unverified.text).not.toContain('netWorth');
  });

  it('(AC-42) gives a user with no data the first steps and zero or empty sections', async () => {
    const { app } = buildRealApp(connection);
    const ana = await addRealUser(connection, app, 'ana');

    const body = await dashboardOf(app, ana.cookies);

    expect(body.firstSteps).toEqual({ hasAccount: false, hasMovement: false, show: true });
    expect(body.netWorth.ars).toBe('0');
    expect(body.netWorth.usd).toBe('0');
    expect(body.month.expenses).toBe('0');
    expect(body.categories).toEqual([]);
    expect(body.budgets).toEqual([]);
    expect(body.upcoming).toEqual([]);
    expect(body.actions).toEqual([]);
    expect(body.insight).toBeNull();
    expect(body.groups.owedToYou).toEqual({ ars: '0', usd: '0' });
    expect(body.groups.youOwe).toEqual({ ars: '0', usd: '0' });
  });

  it('(AC-03, AC-51) returns integer strings for every amount of a full dashboard', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await seedWorld(connection, ana.id, 'ana');

    const response = await getJson(app, '/dashboard', ana.cookies);

    expect(response.status).toBe(200);
    const fields = amountFields(response.body);
    expect(fields.length).toBeGreaterThan(20);
    for (const [path, value] of fields) {
      expect(typeof value, path).toBe('string');
      expect(String(value), path).toMatch(INTEGER_STRING);
    }
    expect(dashboardResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('(AC-04 to AC-13, AC-14 to AC-20, AC-26, AC-30, AC-33) returns the hand-computed figures', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const bea = await addRealUser(connection, app, 'bea');
    const world = await seedWorld(connection, ana.id, 'ana');
    await seedGroup(connection.pool, ana.id, bea.id);

    const body = await dashboardOf(app, ana.cookies);

    expect(body.today).toBe('2026-10-06');
    expect(body.netWorth.parts).toEqual({
      accounts: { ars: '19600000', usd: '98000' },
      investments: { ars: '300000', usd: '0' },
      groups: { ars: '2000000', usd: '0' },
      installmentDebt: { ars: '1500000', usd: '0' },
    });
    expect(body.netWorth.holdingsWithoutPrice).toBe(1);
    expect(body.netWorth.ars).toBe('20400000');
    expect(body.netWorth.usd).toBe('98000');
    // 980.00 USD at 1,400.0000 is 1,372,000.00 ARS.
    expect(body.netWorth.total).toBe('157600000');
    expect(body.netWorth.reason).toBeNull();

    expect(body.month).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-06',
      // The 5,000.00 installment of the statement due 2026-10-09 is not paid yet, so it is pending
      // on cards and not an expense of the month (FEAT-015).
      expenses: '6200000',
      income: '8000000',
      net: '1800000',
      change: { expenses: 520, income: 33, net: -64 },
      pendingCard: { amount: '500000', nextDueDate: '2026-10-09', unconvertedCount: 0 },
    });
    expect(body.categories.map((row) => [row.categoryId, row.amount, row.sharePercent])).toEqual([
      [world.food, '4800000', 77],
      [null, '1000000', 16],
      [world.fun, '400000', 6],
    ]);

    expect(body.budgets.map((row) => [row.budgetId, row.percentUsed, row.status])).toEqual([
      // 5,300,000 of 3,000,000: budgets still count the 5,000.00 installment of the statement due
      // 2026-10-09 in October, paid or not; only the dashboard month leaves it pending (FEAT-015).
      [world.foodBudgetId, 176, 'over'],
      [world.funBudgetId, 80, 'close'],
    ]);

    expect(body.upcoming).toEqual([
      {
        kind: 'recurring_payment',
        paymentId: world.gymPaymentId,
        date: '2026-10-09',
        name: 'Gym',
        currency: 'ARS',
        amount: '1500000',
      },
    ]);
    expect(body.actions.map((row) => row.kind)).toEqual(['overdue_occurrence', 'unpaid_statement']);
    expect(body.actions[1]).toMatchObject({
      statementId: world.statementId,
      cardId: world.cardId,
      dueDate: '2026-10-09',
    });
    expect(body.groups.owedToYou).toEqual({ ars: '2000000', usd: '0' });
    expect(body.firstSteps.show).toBe(false);
  });

  it('(AC-19) leaves a transfer and a currency exchange out of expenses, income and the change', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const world = await seedWorld(connection, ana.id, 'ana');
    const before = await dashboardOf(app, ana.cookies);

    const insert = (
      type: 'transfer' | 'exchange',
      amount: number,
      destinationAmount: number,
      day: string,
    ) =>
      connection.pool.query(
        `insert into movements (owner_id, type, account_id, destination_account_id, amount,
                                destination_amount, occurred_at, rate, rate_source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ana.id,
          type,
          world.accountArs,
          world.accountUsd,
          amount,
          destinationAmount,
          `${day}T15:00:00Z`,
          type === 'exchange' ? 14000000 : null,
          type === 'exchange' ? 'implied' : null,
        ],
      );
    await insert('transfer', 500000, 500000, '2026-10-04');
    await insert('exchange', 1400000, 1000, '2026-10-05');
    await insert('transfer', 300000, 300000, '2026-09-03');
    await insert('exchange', 2800000, 2000, '2026-09-04');

    const after = await dashboardOf(app, ana.cookies);

    expect(after.month.expenses).toBe(before.month.expenses);
    expect(after.month.income).toBe(before.month.income);
    expect(after.month.net).toBe(before.month.net);
    expect(after.month.change).toEqual(before.month.change);
    expect(after.categories).toEqual(before.categories);
  });

  it('(AC-45) each caller sees only their own accounts, budgets, cards and group balance', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const bea = await addRealUser(connection, app, 'bea');
    const anaWorld = await seedWorld(connection, ana.id, 'ana');
    const beaWorld = await seedWorld(connection, bea.id, 'bea');
    await seedGroup(connection.pool, ana.id, bea.id);

    const anaBody = await dashboardOf(app, ana.cookies);
    const beaBody = await dashboardOf(app, bea.cookies);

    const ids = (body: DashboardResponse) => [
      ...body.budgets.map((row) => row.budgetId),
      ...body.actions.flatMap((row) => (row.kind === 'unpaid_statement' ? [row.cardId] : [])),
    ];
    expect(ids(anaBody).sort()).toEqual(
      [anaWorld.foodBudgetId, anaWorld.funBudgetId, anaWorld.cardId].sort(),
    );
    expect(ids(beaBody).sort()).toEqual(
      [beaWorld.foodBudgetId, beaWorld.funBudgetId, beaWorld.cardId].sort(),
    );
    // Same fixtures, so the personal parts are equal; the group sides are opposite.
    expect(anaBody.netWorth.parts.accounts).toEqual(beaBody.netWorth.parts.accounts);
    expect(anaBody.groups.owedToYou.ars).toBe('2000000');
    expect(anaBody.groups.youOwe.ars).toBe('0');
    expect(beaBody.groups.owedToYou.ars).toBe('0');
    expect(beaBody.groups.youOwe.ars).toBe('2000000');
    // A group member's month holds their own share only: Ana 10,000.00, Bea 20,000.00.
    expect(anaBody.categories.find((row) => row.categoryId === null)?.amount).toBe('1000000');
    expect(beaBody.categories.find((row) => row.categoryId === null)?.amount).toBe('2000000');
  });

  it('(AC-49) answers the standard 500 with no section, stack or SQL when a source fails', async () => {
    const { app } = buildRealApp(connection);
    const ana = await addRealUser(connection, app, 'ana');
    vi.spyOn(DrizzleFlowReader.prototype, 'personalRows').mockRejectedValue(
      new Error('select * from movements: connection lost'),
    );

    const response = await getJson(app, '/dashboard', ana.cookies);

    expect(response.status).toBe(500);
    expect(response.text).not.toContain('netWorth');
    expect(response.text).not.toContain('select');
    expect(response.text).not.toContain('stack');
  });
});
