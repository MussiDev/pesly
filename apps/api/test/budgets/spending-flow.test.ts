import {
  budgetSpendingListResponseSchema,
  budgetSpendingResponseSchema,
  type BudgetSpendingResponse,
} from '@pesly/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount } from '../movements/db-fixtures';
import { newCard, newInstallmentPurchase, newStatement } from '../reports/flow-fixtures';
import { buildApp, call, MovableClock, PASSWORD, type Owner } from './route-harness';
import {
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
  newNamedCategory,
} from './spending-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const SEPTEMBER = new Date('2026-09-15T16:00:00.000Z');
const OCTOBER = new Date('2026-10-06T16:00:00.000Z');

let connection: DatabaseConnection;
let sequence = 0;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

type App = ReturnType<typeof buildApp>['app'];

/** A verified user living in Buenos Aires. */
async function person(app: App, name: string): Promise<Owner> {
  sequence += 1;
  const email = `${name}-${sequence}@spending-flow.test`;
  const id = await seedUser(connection, { email, password: PASSWORD, timeZone: BUENOS_AIRES });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

async function world(clock = new MovableClock(OCTOBER)) {
  const built = buildApp(connection, clock);
  const ana = await person(built.app, 'ana');
  return { ...built, ana };
}

const codeOf = (response: { body: { error?: { code?: string }; code?: string } }) =>
  response.body.error?.code ?? response.body.code;

async function budgetSpending(
  app: App,
  owner: Owner,
  budgetId: string,
  month?: string,
): Promise<BudgetSpendingResponse> {
  const suffix = month === undefined ? '' : `?month=${month}`;
  const response = await call(app, 'get', `/budgets/${budgetId}/spending${suffix}`, owner.cookies);
  expect(response.status).toBe(200);
  return budgetSpendingResponseSchema.parse(response.body);
}

async function listSpending(app: App, owner: Owner, month?: string) {
  const suffix = month === undefined ? '' : `?month=${month}`;
  const response = await call(app, 'get', `/budgets/spending${suffix}`, owner.cookies);
  expect(response.status).toBe(200);
  return budgetSpendingListResponseSchema.parse(response.body);
}

async function createBudget(
  app: App,
  owner: Owner,
  fields: Record<string, unknown>,
): Promise<string> {
  const response = await call(app, 'post', '/budgets', owner.cookies, fields);
  expect(response.status).toBe(201);
  return response.body.id;
}

describe('budget spending flow over PostgreSQL', () => {
  it('reads October and September with exact amounts, remaining, percentages and rollover (AC-01, AC-06, AC-13, AC-18)', async () => {
    const clock = new MovableClock(SEPTEMBER);
    const { app, ana } = await world(clock);
    const pool = connection.pool;
    const account = await newAccount(pool, ana.id);
    const food = await newNamedCategory(pool, ana.id, { name: 'Food' });
    const transport = await newNamedCategory(pool, ana.id, { name: 'Transport' });
    const foodBudget = await createBudget(app, ana, {
      name: 'Groceries',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [food],
      rollover: true,
    });
    const transportBudget = await createBudget(app, ana, {
      name: 'Commute',
      amount: '5000000',
      currency: 'ARS',
      categoryIds: [transport],
    });
    const spend = (categoryId: string, amount: bigint, occurredAt: string) =>
      newMovementAt(pool, { ownerId: ana.id, accountId: account, categoryId, amount, occurredAt });
    await spend(food, 12000000n, '2026-09-10T12:00:00Z');
    await spend(transport, 1000000n, '2026-09-12T12:00:00Z');
    await spend(food, 5000000n, '2026-10-02T12:00:00Z');
    await spend(transport, 6000000n, '2026-10-03T12:00:00Z');

    clock.current = OCTOBER;
    const edited = await call(app, 'patch', `/budgets/${foodBudget}`, ana.cookies, {
      amount: '20000000',
    });
    expect(edited.status).toBe(200);

    const october = await listSpending(app, ana);
    expect(october.month).toBe('2026-10');
    const byName = new Map(october.budgets.map((budget) => [budget.name, budget]));
    expect(byName.get('Groceries')).toMatchObject({
      budgetId: foodBudget,
      amount: '20000000',
      rolloverEnabled: true,
      rolloverAmount: '3000000',
      available: '23000000',
      spent: '5000000',
      remaining: '18000000',
      percentUsed: 21,
    });
    expect(byName.get('Commute')).toMatchObject({
      budgetId: transportBudget,
      rolloverAmount: '0',
      available: '5000000',
      spent: '6000000',
      remaining: '-1000000',
      percentUsed: 120,
    });

    const september = await listSpending(app, ana, '2026-09');
    const septemberByName = new Map(september.budgets.map((budget) => [budget.name, budget]));
    expect(september.month).toBe('2026-09');
    expect(septemberByName.get('Groceries')).toMatchObject({
      amount: '15000000',
      rolloverAmount: '0',
      available: '15000000',
      spent: '12000000',
      remaining: '3000000',
      percentUsed: 80,
    });
    expect(septemberByName.get('Commute')).toMatchObject({
      spent: '1000000',
      remaining: '4000000',
      percentUsed: 20,
    });
    expect(await budgetSpending(app, ana, foodBudget, '2026-10')).toEqual(byName.get('Groceries'));
  });

  it('counts card purchases and installments in the month their statement is due, once, with rollover and the left-out USD installment (AC-01, AC-02, AC-07, AC-10, AC-27)', async () => {
    const clock = new MovableClock(new Date('2026-08-15T16:00:00.000Z'));
    const { app, ana } = await world(clock);
    const pool = connection.pool;
    const cash = await newAccount(pool, ana.id, false, 'ARS');
    const cardArs = await newAccount(pool, ana.id, false, 'ARS');
    const cardUsd = await newAccount(pool, ana.id, false, 'USD');
    const food = await newNamedCategory(pool, ana.id, { name: 'Food' });
    const budgetId = await createBudget(app, ana, {
      name: 'Groceries',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [food],
      rollover: true,
    });
    const cardId = await newCard(pool, {
      ownerId: ana.id,
      arsAccountId: cardArs,
      usdAccountId: cardUsd,
      closingDay: 24,
      dueDay: 5,
    });
    for (const [period, closingDate, dueDate] of [
      ['2026-08', '2026-08-24', '2026-09-05'],
      ['2026-09', '2026-09-24', '2026-10-05'],
      ['2026-10', '2026-10-24', '2026-11-05'],
    ] as const) {
      await newStatement(pool, { cardId, ownerId: ana.id, period, closingDate, dueDate });
    }
    const spend = (accountId: string, amount: bigint, occurredAt: string) =>
      newMovementAt(pool, { ownerId: ana.id, accountId, categoryId: food, amount, occurredAt });
    // The August statement is due 5 Sep; the September one, 5 Oct.
    await spend(cardArs, 13000000n, '2026-08-20T15:00:00Z');
    await spend(cardArs, 3000000n, '2026-09-20T15:00:00Z');
    await spend(cash, 500000n, '2026-10-02T15:00:00Z');
    await newInstallmentPurchase(pool, {
      ownerId: ana.id,
      cardId,
      categoryId: food,
      installments: [
        { period: '2026-09', amount: 1000000n },
        { period: '2026-10', amount: 1000000n },
      ],
    });
    await newInstallmentPurchase(pool, {
      ownerId: ana.id,
      cardId,
      categoryId: food,
      currency: 'USD',
      installments: [{ period: '2026-09', amount: 1000n }],
    });

    clock.current = OCTOBER;
    const october = await budgetSpending(app, ana, budgetId, '2026-10');
    const september = await budgetSpending(app, ana, budgetId, '2026-09');

    // October: the 30,000.00 purchase of 20 Sep, the first 10,000.00 installment and the cash expense.
    expect(october).toMatchObject({
      spent: '4500000',
      rolloverAmount: '2000000',
      available: '17000000',
      unconvertedInstallmentCount: 1,
    });
    // September: only the purchase of 20 Aug, whose statement is due 5 Sep.
    expect(september).toMatchObject({ spent: '13000000', unconvertedInstallmentCount: 0 });
    const listed = (await listSpending(app, ana, '2026-10')).budgets[0];
    expect(listed).toEqual(october);
  });

  it('converts at the frozen rate in both directions and ignores later changes of the stored rates (AC-07, AC-08, AC-09)', async () => {
    const { app, ana } = await world();
    const pool = connection.pool;
    const usd = await newAccount(pool, ana.id, false, 'USD');
    const ars = await newAccount(pool, ana.id, false, 'ARS');
    const dollars = await newNamedCategory(pool, ana.id, { name: 'Dollar spending' });
    const pesos = await newNamedCategory(pool, ana.id, { name: 'Peso spending' });
    // 20.00 USD frozen at 1,500.0000 ARS per USD is 30,000.00 ARS.
    await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: usd,
      categoryId: dollars,
      amount: 2000n,
      rate: 15000000n,
      occurredAt: '2026-10-02T12:00:00Z',
    });
    // 30,000.00 ARS at the same rate is 20.00 USD.
    await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: ars,
      categoryId: pesos,
      amount: 3000000n,
      rate: 15000000n,
      occurredAt: '2026-10-03T12:00:00Z',
    });
    const arsBudget = await createBudget(app, ana, {
      name: 'In pesos',
      amount: '10000000',
      currency: 'ARS',
      categoryIds: [dollars],
    });
    const usdBudget = await createBudget(app, ana, {
      name: 'In dollars',
      amount: '10000',
      currency: 'USD',
      categoryIds: [pesos],
    });

    const before = [
      await budgetSpending(app, ana, arsBudget),
      await budgetSpending(app, ana, usdBudget),
    ];
    expect(before[0]).toMatchObject({ spent: '3000000', remaining: '7000000', percentUsed: 30 });
    expect(before[1]).toMatchObject({ spent: '2000', remaining: '8000', percentUsed: 20 });

    for (const sell of [1n, 99999n]) {
      await pool.query(
        `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
         values ('mep', $1, $1, now(), now())
         on conflict (rate_type) do update set buy = excluded.buy, sell = excluded.sell`,
        [sell.toString()],
      );
      expect([
        await budgetSpending(app, ana, arsBudget),
        await budgetSpending(app, ana, usdBudget),
      ]).toEqual(before);
    }
  });

  it('counts a group share by the matching category name, none for another name, and the payer movement once (AC-10, AC-11, AC-26)', async () => {
    const { app, ana } = await world();
    const pool = connection.pool;
    const account = await newAccount(pool, ana.id);
    const food = await newNamedCategory(pool, ana.id, { name: 'food' });
    const budget = await createBudget(app, ana, {
      name: 'Eating out',
      amount: '10000000',
      currency: 'ARS',
      categoryIds: [food],
    });
    const group = await newGroup(pool);
    const me = await newMember(pool, group, ana.id);
    const ghost = await newMember(pool, group, null);
    const groupFood = await newGroupCategory(pool, group, { name: 'Food' });
    const groupOther = await newGroupCategory(pool, group, { name: 'Gifts' });
    // The payer movement of the 8,000,000 dinner sits in the budget's own category: it must not
    // count next to the 4,000,000 share of the caller.
    const payerMovement = await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: account,
      categoryId: food,
      amount: 8000000n,
      occurredAt: '2026-10-04T12:00:00Z',
    });
    await newGroupExpense(pool, {
      groupId: group,
      payerMemberId: me,
      categoryId: groupFood,
      amount: 8000000n,
      occurredAt: '2026-10-04T12:00:00Z',
      payerMovementId: payerMovement,
      shares: [
        { memberId: me, amount: 4000000n },
        { memberId: ghost, amount: 4000000n },
      ],
    });
    await newGroupExpense(pool, {
      groupId: group,
      payerMemberId: ghost,
      categoryId: groupOther,
      amount: 6000000n,
      occurredAt: '2026-10-05T12:00:00Z',
      shares: [
        { memberId: me, amount: 3000000n },
        { memberId: ghost, amount: 3000000n },
      ],
    });

    expect(await budgetSpending(app, ana, budget)).toMatchObject({
      spent: '4000000',
      remaining: '6000000',
      percentUsed: 40,
      unconvertedShareCount: 0,
    });
  });

  it('changes the October rollover when a September expense is edited after October began (AC-21)', async () => {
    const clock = new MovableClock(SEPTEMBER);
    const { app, ana } = await world(clock);
    const pool = connection.pool;
    const account = await newAccount(pool, ana.id);
    const food = await newNamedCategory(pool, ana.id, { name: 'Food' });
    const budget = await createBudget(app, ana, {
      name: 'Groceries',
      amount: '10000000',
      currency: 'ARS',
      categoryIds: [food],
      rollover: true,
    });
    const expense = await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: account,
      categoryId: food,
      amount: 4000000n,
      occurredAt: '2026-09-10T12:00:00Z',
    });
    clock.current = OCTOBER;
    // A version for October, so September is the previous month of a budget that carries over.
    await call(app, 'patch', `/budgets/${budget}`, ana.cookies, { name: 'Groceries Oct' });
    expect(await budgetSpending(app, ana, budget)).toMatchObject({
      rolloverAmount: '6000000',
      available: '16000000',
    });

    // The movement routes are not part of this module: the edit is the row update they perform.
    await pool.query('update movements set amount = $1 where id = $2', ['9000000', expense]);

    expect(await budgetSpending(app, ana, budget)).toMatchObject({
      rolloverAmount: '1000000',
      available: '11000000',
    });
  });

  it('rejects a future month, a malformed month, and a month before the budget (AC-16, AC-17)', async () => {
    const { app, ana } = await world();
    const food = await newNamedCategory(connection.pool, ana.id, { name: 'Food' });
    const budget = await createBudget(app, ana, {
      name: 'Groceries',
      amount: '1000',
      currency: 'ARS',
      categoryIds: [food],
    });

    const future = await call(app, 'get', '/budgets/spending?month=2026-11', ana.cookies);
    expect(future.status).toBe(400);
    expect(codeOf(future)).toBe('BUDGET_MONTH_IN_FUTURE');
    const futureById = await call(
      app,
      'get',
      `/budgets/${budget}/spending?month=2027-01`,
      ana.cookies,
    );
    expect(futureById.status).toBe(400);
    expect(codeOf(futureById)).toBe('BUDGET_MONTH_IN_FUTURE');
    for (const month of ['2026-13', '2026-1', '2026-10-01', '']) {
      const malformed = await call(app, 'get', `/budgets/spending?month=${month}`, ana.cookies);
      expect(malformed.status).toBe(400);
      expect(codeOf(malformed)).toBe('VALIDATION_FAILED');
    }

    // The budget was created in October: September is before it existed.
    expect((await listSpending(app, ana, '2026-09')).budgets).toEqual([]);
    const before = await call(app, 'get', `/budgets/${budget}/spending?month=2026-09`, ana.cookies);
    expect(before.status).toBe(404);
    expect(codeOf(before)).toBe('NOT_FOUND');
  });

  it("answers 404 for another user's budget as for an unknown id, scopes each list and requires a session (AC-23, AC-24, AC-25)", async () => {
    const { app, ana } = await world();
    const bob = await person(app, 'bob');
    const pool = connection.pool;
    const anaFood = await newNamedCategory(pool, ana.id, { name: 'Food' });
    const bobFood = await newNamedCategory(pool, bob.id, { name: 'Food' });
    const anaBudget = await createBudget(app, ana, {
      name: 'Ana only',
      amount: '1234500',
      currency: 'ARS',
      categoryIds: [anaFood],
    });
    await createBudget(app, bob, {
      name: 'Bob only',
      amount: '777',
      currency: 'ARS',
      categoryIds: [bobFood],
    });

    const foreign = await call(app, 'get', `/budgets/${anaBudget}/spending`, bob.cookies);
    const unknown = await call(app, 'get', `/budgets/${randomUUID()}/spending`, bob.cookies);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);

    expect((await listSpending(app, ana)).budgets.map((budget) => budget.name)).toEqual([
      'Ana only',
    ]);
    expect((await listSpending(app, bob)).budgets.map((budget) => budget.name)).toEqual([
      'Bob only',
    ]);

    for (const path of ['/budgets/spending', `/budgets/${anaBudget}/spending`]) {
      const anonymous = await call(app, 'get', path);
      expect(anonymous.status).toBe(401);
      expect(codeOf(anonymous)).toBe('UNAUTHENTICATED');
      expect(JSON.stringify(anonymous.body)).not.toMatch(/Ana only|1234500|amount|spent/);
    }
  });

  it('returns the same spending from a second API instance (no process state)', async () => {
    const first = await world();
    const second = buildApp(connection, new MovableClock(OCTOBER));
    const pool = connection.pool;
    const account = await newAccount(pool, first.ana.id);
    const food = await newNamedCategory(pool, first.ana.id, { name: 'Food' });
    await createBudget(first.app, first.ana, {
      name: 'Groceries',
      amount: '10000000',
      currency: 'ARS',
      categoryIds: [food],
    });
    await newMovementAt(pool, {
      ownerId: first.ana.id,
      accountId: account,
      categoryId: food,
      amount: 2500000n,
      occurredAt: '2026-10-02T12:00:00Z',
    });

    const fromFirst = await call(first.app, 'get', '/budgets/spending', first.ana.cookies);
    const fromSecond = await call(second.app, 'get', '/budgets/spending', first.ana.cookies);

    expect(fromFirst.status).toBe(200);
    expect(fromSecond.status).toBe(200);
    expect(fromSecond.body).toEqual(fromFirst.body);
    expect(budgetSpendingListResponseSchema.parse(fromSecond.body).budgets[0]?.spent).toBe(
      '2500000',
    );
  });

  it('writes no budget name or amount to the logs', async () => {
    const { app, ana, lines } = await world();
    const pool = connection.pool;
    const account = await newAccount(pool, ana.id);
    const category = await newNamedCategory(pool, ana.id, { name: 'Secret category' });
    const budget = await createBudget(app, ana, {
      name: 'Secret budget',
      amount: '98765431',
      currency: 'ARS',
      categoryIds: [category],
    });
    await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: account,
      categoryId: category,
      amount: 87654321n,
      occurredAt: '2026-10-02T12:00:00Z',
    });
    await listSpending(app, ana);
    await budgetSpending(app, ana, budget);
    await call(app, 'get', '/budgets/spending?month=2026-12', ana.cookies);

    const logged = lines.join('\n');
    expect(logged).toContain('budget spending listed');
    expect(logged).toContain('budget spending read');
    for (const secret of ['Secret budget', 'Secret category', '98765431', '87654321']) {
      expect(logged).not.toContain(secret);
    }
  });
});
