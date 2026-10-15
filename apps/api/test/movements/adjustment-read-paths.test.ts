import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListMovements } from '../../src/movements/application/list-movements';
import { createAccountMovements } from '../../src/movements/infrastructure/accounts/drizzle-account-movements';
import {
  DrizzleMovementRepository,
  toMovement,
  type MovementRow,
} from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { presentMovement } from '../../src/movements/infrastructure/http/movement-presenter';
import { DrizzleFirstStepsReader } from '../../src/dashboard/infrastructure/db/drizzle-first-steps-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newMovementAt } from '../budgets/spending-fixtures';
import { FakeUserPreferences, InMemoryMovementRepository, readScopeFor } from './fakes';
import {
  newAccount,
  newAdjustment,
  newCategory,
  newUserId,
  readScope,
  writeScope,
} from './db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleMovementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleMovementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const BASE_ROW: MovementRow = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: '22222222-2222-4222-8222-222222222222',
  type: 'adjustment',
  accountId: '33333333-3333-4333-8333-333333333333',
  categoryId: null,
  amount: -250n,
  occurredAt: new Date('2026-10-02T15:30:00.000Z'),
  note: 'cash count',
  rate: null,
  rateSource: null,
  rateType: null,
  destinationAccountId: null,
  destinationAmount: null,
  createdAt: new Date('2026-10-02T15:30:00.000Z'),
};

describe('toMovement and the presenter', () => {
  it('maps an adjustment row to its variant and keeps the sign', () => {
    const movement = toMovement(BASE_ROW);

    expect(movement).toMatchObject({ type: 'adjustment', amount: -250n, note: 'cash count' });
    expect(presentMovement(movement)).toMatchObject({
      type: 'adjustment',
      amount: '-250',
      categoryId: null,
      destinationAccountId: null,
      destinationAmount: null,
      rate: null,
      rateSource: null,
      rateType: null,
    });
  });

  it('raises for an adjustment row that carries a category, a rate or a destination', () => {
    expect(() => toMovement({ ...BASE_ROW, categoryId: BASE_ROW.accountId })).toThrow(
      /inconsistent/i,
    );
    expect(() => toMovement({ ...BASE_ROW, rate: 1n, rateSource: 'manual' })).toThrow(
      /inconsistent/i,
    );
    expect(() => toMovement({ ...BASE_ROW, destinationAccountId: BASE_ROW.accountId })).toThrow(
      /inconsistent/i,
    );
  });

  it('raises for a row with an unknown type', () => {
    // The column is text: a future or corrupt value reaches the mapper as a plain string.
    const row = { ...BASE_ROW, type: 'bonus' } as unknown as MovementRow;

    expect(() => toMovement(row)).toThrow(/unknown type/i);
  });
});

describe('account balance sums', () => {
  it('adds a positive adjustment and applies the sign of a negative one (AC-03)', async () => {
    const owner = await newUserId(connection.db);
    const account = await newAccount(connection.pool, owner);
    const category = await newCategory(connection.pool, owner, 'income');
    const sums = createAccountMovements(connection.db);
    await newMovementAt(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: category,
      type: 'income',
      amount: 10_000n,
      occurredAt: '2026-10-01T12:00:00Z',
    });

    await newAdjustment(connection.pool, { ownerId: owner, accountId: account, amount: 2_500n });
    expect((await sums.sumsByAccount([account])).get(account)).toBe(12_500n);

    await newAdjustment(connection.pool, { ownerId: owner, accountId: account, amount: -4_000n });
    expect((await sums.sumsByAccount([account])).get(account)).toBe(8_500n);
  });

  it('an account with only a negative adjustment sums to that negative amount (AC-03)', async () => {
    const owner = await newUserId(connection.db);
    const account = await newAccount(connection.pool, owner);
    await newAdjustment(connection.pool, { ownerId: owner, accountId: account, amount: -700n });

    expect(
      (await createAccountMovements(connection.db).sumsByAccount([account])).get(account),
    ).toBe(-700n);
  });
});

describe('movements list', () => {
  it('returns the adjustment with its type and hides it with hideAdjustments (AC-06)', async () => {
    const owner = await newUserId(connection.db);
    const account = await newAccount(connection.pool, owner);
    const category = await newCategory(connection.pool, owner, 'expense');
    const adjustmentId = await newAdjustment(connection.pool, {
      ownerId: owner,
      accountId: account,
      amount: -300n,
      occurredAt: '2026-10-03T12:00:00Z',
    });
    const expenseId = await newMovementAt(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: category,
      amount: 100n,
      occurredAt: '2026-10-02T12:00:00Z',
    });
    const scope = await readScope(owner);
    const page = { limit: 50, offset: 0 };

    const all = await repository.list(scope, { ...page, filters: {} });
    const hidden = await repository.list(scope, { ...page, filters: { hideAdjustments: true } });
    const shown = await repository.list(scope, { ...page, filters: { hideAdjustments: false } });
    const only = await repository.list(scope, { ...page, filters: { type: 'adjustment' } });

    expect(all.items.map((m) => [m.id, m.type])).toEqual([
      [adjustmentId, 'adjustment'],
      [expenseId, 'expense'],
    ]);
    expect(hidden.items.map((m) => m.id)).toEqual([expenseId]);
    expect(hidden.total).toBe(1);
    expect(shown.total).toBe(2);
    expect(only.items.map((m) => m.id)).toEqual([adjustmentId]);
  });

  it('inserts and finds an adjustment through the repository writer', async () => {
    const owner = await newUserId(connection.db);
    const account = await newAccount(connection.pool, owner);

    const stored = await repository.insert(await writeScope(owner), {
      type: 'adjustment',
      accountId: account,
      amount: -42n,
      occurredAt: new Date('2026-10-04T10:00:00Z'),
      note: null,
    });

    expect(stored).toMatchObject({ type: 'adjustment', amount: -42n, ownerId: owner });
    expect(await repository.findById(await readScope(owner), stored.id)).toEqual(stored);
  });

  it('the use case turns the "true" query text into the boolean filter', async () => {
    const movements = new InMemoryMovementRepository();
    const list = new ListMovements({ movements, preferences: new FakeUserPreferences() });
    const scope = await readScopeFor('11111111-1111-4111-8111-111111111111');

    await list.execute(scope, { limit: 10, offset: 0, hideAdjustments: 'true' });
    await list.execute(scope, { limit: 10, offset: 0, hideAdjustments: 'false' });
    await list.execute(scope, { limit: 10, offset: 0 });

    expect(movements.listCalls.map((call) => call.options.filters.hideAdjustments)).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });
});

describe('first steps probe', () => {
  it('does not count an adjustment as a first movement', async () => {
    const owner = await newUserId(connection.db);
    const account = await newAccount(connection.pool, owner);
    await newAdjustment(connection.pool, { ownerId: owner, accountId: account, amount: 500n });
    const reader = new DrizzleFirstStepsReader(connection.db);

    expect(await reader.firstStepsOf(await readScope(owner))).toEqual({
      hasAccount: true,
      hasMovement: false,
    });
  });
});
