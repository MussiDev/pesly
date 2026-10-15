import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthBounds, previousMonth } from '../../src/budgets/domain/month';
import { DrizzleSpendingReader } from '../../src/budgets/infrastructure/db/drizzle-spending-reader';
import { DrizzleGroupBalanceReader } from '../../src/dashboard/infrastructure/db/drizzle-group-balance-reader';
import type { FlowWindow } from '../../src/reports/application/ports/flow-reader';
import { DrizzleAccountFlowReader } from '../../src/reports/infrastructure/db/drizzle-account-flow-reader';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { DrizzleGroupFlowReader } from '../../src/reports/infrastructure/db/drizzle-group-flow-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newAdjustment,
  newCategory,
  newUserId,
  readScope,
} from '../movements/db-fixtures';
import {
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
} from './flow-fixtures';
import { accountWith, windowFor } from './net-worth-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const ZONE = 'America/Argentina/Buenos_Aires';
const TODAY = '2026-10-12';

describe('DrizzleAccountFlowReader and adjustments', () => {
  it('puts an adjustment in the month of its date and leaves earlier months equal (AC-04)', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner, opening: 100_000n });
    const scope = await readScope(owner);
    const reader = new DrizzleAccountFlowReader(connection.db);
    const window = windowFor('2026-08', '2026-10', TODAY);

    const before = await reader.accountFlows(scope, window);
    await newAdjustment(connection.pool, {
      ownerId: owner,
      accountId: account,
      amount: -30_000n,
      occurredAt: '2026-09-15T15:00:00Z',
    });
    await newAdjustment(connection.pool, {
      ownerId: owner,
      accountId: account,
      amount: 5_000n,
      occurredAt: '2026-10-02T15:00:00Z',
    });
    const after = await reader.accountFlows(scope, window);

    expect(after.opening).toEqual(before.opening);
    expect(after.baseline).toEqual(before.baseline);
    expect(before.byMonth.get('2026-08')).toBeUndefined();
    expect(after.byMonth.get('2026-08')).toBeUndefined();
    expect(after.byMonth.get('2026-09')).toEqual({ ARS: -30_000n, USD: 0n });
    expect(after.byMonth.get('2026-10')).toEqual({ ARS: 5_000n, USD: 0n });
  });

  it('puts an adjustment before the window in the baseline, with its own sign', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner, currency: 'USD' });
    await newAdjustment(connection.pool, {
      ownerId: owner,
      accountId: account,
      amount: -250n,
      occurredAt: '2026-01-15T15:00:00Z',
    });

    const flows = await new DrizzleAccountFlowReader(connection.db).accountFlows(
      await readScope(owner),
      windowFor('2026-08', '2026-10', TODAY),
    );

    expect(flows.baseline).toEqual({ ARS: 0n, USD: -250n });
  });

  it('ignores the adjustments of an archived account', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner, archived: true });
    await newAdjustment(connection.pool, {
      ownerId: owner,
      accountId: account,
      amount: 900n,
      occurredAt: '2026-09-15T15:00:00Z',
    });

    const flows = await new DrizzleAccountFlowReader(connection.db).accountFlows(
      await readScope(owner),
      windowFor('2026-08', '2026-10', TODAY),
    );

    expect(flows.byMonth.size).toBe(0);
    expect(flows.baseline).toEqual({ ARS: 0n, USD: 0n });
  });
});

describe('figures with and without an adjustment (AC-05)', () => {
  it('reports, the budget spending, the month flows and group balances do not change', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const scope = await readScope(me);
    const ars = await newAccount(connection.pool, me, false, 'ARS');
    const usd = await newAccount(connection.pool, me, false, 'USD');
    const food = await newCategory(connection.pool, me, 'expense');
    const salary = await newCategory(connection.pool, me, 'income');
    await newMovementAt(connection.pool, {
      ownerId: me,
      accountId: ars,
      categoryId: food,
      amount: 5_000_00n,
      occurredAt: '2026-10-05T15:00:00Z',
    });
    await newMovementAt(connection.pool, {
      ownerId: me,
      accountId: usd,
      categoryId: food,
      amount: 2_000n,
      occurredAt: '2026-09-05T15:00:00Z',
    });
    await newMovementAt(connection.pool, {
      ownerId: me,
      accountId: ars,
      categoryId: salary,
      type: 'income',
      amount: 90_000_00n,
      occurredAt: '2026-10-01T15:00:00Z',
    });
    const group = await newGroup(connection.pool);
    const mine = await newMember(connection.pool, group, me);
    const theirs = await newMember(connection.pool, group, other);
    const groupCategory = await newGroupCategory(connection.pool, group, { name: 'Food' });
    await newGroupExpense(connection.pool, {
      groupId: group,
      payerMemberId: mine,
      categoryId: groupCategory,
      amount: 4_000_00n,
      occurredAt: '2026-10-06T15:00:00Z',
      shares: [
        { memberId: mine, amount: 2_000_00n },
        { memberId: theirs, amount: 2_000_00n },
      ],
    });

    const flowWindow: FlowWindow = {
      from: new Date('2000-01-01T00:00:00Z'),
      before: new Date('2100-01-01T00:00:00Z'),
      timeZone: ZONE,
    };
    const spendingWindow = {
      current: monthBounds('2026-10', ZONE),
      previous: monthBounds(previousMonth('2026-10'), ZONE),
    };
    const flows = new DrizzleFlowReader(connection.db);
    const spending = new DrizzleSpendingReader(connection.db);
    const balances = new DrizzleGroupBalanceReader(connection.db);
    const groupFlows = new DrizzleGroupFlowReader(connection.db);
    const netWorthWindow = windowFor('2026-09', '2026-10', TODAY);
    const read = async () => ({
      personal: await flows.personalRows(scope, flowWindow),
      shares: await flows.shareRows(scope, flowWindow),
      spent: await spending.personalSpending(scope, spendingWindow, [food]),
      cards: await spending.cardPurchaseSpending(scope, spendingWindow, [food], ZONE),
      groupBalances: await balances.sourcesOf(scope),
      groupFlows: await groupFlows.groupFlows(scope, netWorthWindow),
    });

    const without = await read();
    await newAdjustment(connection.pool, {
      ownerId: me,
      accountId: ars,
      amount: -12_345n,
      occurredAt: '2026-10-07T15:00:00Z',
    });
    await newAdjustment(connection.pool, {
      ownerId: me,
      accountId: usd,
      amount: 777n,
      occurredAt: '2026-09-07T15:00:00Z',
    });
    const withAdjustments = await read();

    expect(without.personal.length).toBeGreaterThan(0);
    expect(without.spent.length).toBeGreaterThan(0);
    expect(withAdjustments).toEqual(without);
  });
});
