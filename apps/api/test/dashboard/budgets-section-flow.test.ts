import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetSpendingListResponseSchema } from '@pesly/shared';
import { DrizzleBudgetVersionReader, DrizzleSpendingReader } from '../../src/budgets';
import { buildBudgets } from '../../src/dashboard/application/build-budgets';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import { DrizzleReportPreferences } from '../../src/reports';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { buildApp, call, MovableClock, PASSWORD } from '../budgets/route-harness';
import { newBudgetWithVersions, newMovementAt } from '../budgets/spending-fixtures';
import { seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, readScope } from '../movements/db-fixtures';
import { newCard, newInstallmentPurchase, newStatement } from '../reports/flow-fixtures';
import { FixedClock } from './fakes';

const NOW = new Date('2026-10-06T16:00:00.000Z');
const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('budgets section over PostgreSQL', () => {
  it('matches the percentUsed of the budgets spending list, rollover included (AC-48)', async () => {
    const { app } = buildApp(connection, new MovableClock(NOW));
    const email = `ana-${Date.now()}@dashboard-budgets.test`;
    const userId = await seedUser(connection, {
      email,
      password: PASSWORD,
      timeZone: BUENOS_AIRES,
    });
    const cookies = sessionFrom(await signIn(app, email, PASSWORD));
    const pool = connection.pool;
    const account = await newAccount(pool, userId);
    const food = await newCategory(pool, userId, 'expense');
    const fun = await newCategory(pool, userId, 'expense');

    await newBudgetWithVersions(pool, {
      ownerId: userId,
      versions: [
        {
          effectiveFrom: '2026-09-01',
          name: 'Food',
          amount: 10000n,
          rollover: true,
          categoryIds: [food],
        },
      ],
    });
    await newBudgetWithVersions(pool, {
      ownerId: userId,
      versions: [{ effectiveFrom: '2026-09-01', name: 'Fun', amount: 20000n, categoryIds: [fun] }],
    });
    await newMovementAt(pool, {
      ownerId: userId,
      accountId: account,
      categoryId: food,
      amount: 4000n,
      occurredAt: '2026-09-10T15:00:00Z',
    });
    await newMovementAt(pool, {
      ownerId: userId,
      accountId: account,
      categoryId: food,
      amount: 9000n,
      occurredAt: '2026-10-02T15:00:00Z',
    });
    await newMovementAt(pool, {
      ownerId: userId,
      accountId: account,
      categoryId: fun,
      amount: 5000n,
      occurredAt: '2026-10-03T15:00:00Z',
    });

    const scope = await readScope(userId);
    const clock = new FixedClock(NOW);
    const context = await prepareDashboard(
      { clock, preferences: new DrizzleReportPreferences(connection.db) },
      scope,
    );
    const section = await buildBudgets(
      {
        versions: new DrizzleBudgetVersionReader(connection.db),
        spending: new DrizzleSpendingReader(connection.db),
        clock,
      },
      scope,
      context,
    );

    const response = await call(app, 'get', '/budgets/spending', cookies);
    const listed = budgetSpendingListResponseSchema.parse(response.body);
    const byId = new Map(listed.budgets.map((row) => [row.budgetId, row.percentUsed]));
    expect(section).toHaveLength(2);
    for (const row of section) expect(row.percentUsed).toBe(byId.get(row.budgetId));
    // Food: 10,000 + 6,000 rolled over, 9,000 spent = 56 percent; Fun: 5,000 of 20,000 = 25 percent.
    expect(
      section.map((row) => [row.name, row.available, row.spent, row.percentUsed, row.status]),
    ).toEqual([
      ['Food', 16000n, 9000n, 56, 'on_track'],
      ['Fun', 20000n, 5000n, 25, 'on_track'],
    ]);
  });

  it('shows the same spent as the budget endpoint with a card purchase and an installment (FR-08)', async () => {
    const { app } = buildApp(connection, new MovableClock(NOW));
    const email = `ana-cards-${Date.now()}@dashboard-budgets.test`;
    const userId = await seedUser(connection, {
      email,
      password: PASSWORD,
      timeZone: BUENOS_AIRES,
    });
    const cookies = sessionFrom(await signIn(app, email, PASSWORD));
    const pool = connection.pool;
    const cardArs = await newAccount(pool, userId);
    const cardUsd = await newAccount(pool, userId, false, 'USD');
    const food = await newCategory(pool, userId, 'expense');
    await newBudgetWithVersions(pool, {
      ownerId: userId,
      versions: [
        { effectiveFrom: '2026-09-01', name: 'Food', amount: 20000n, categoryIds: [food] },
      ],
    });
    const cardId = await newCard(pool, {
      ownerId: userId,
      arsAccountId: cardArs,
      usdAccountId: cardUsd,
      closingDay: 24,
      dueDay: 5,
    });
    await newStatement(pool, {
      cardId,
      ownerId: userId,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    // Dated in September, on the statement due 5 Oct: it belongs to October.
    await newMovementAt(pool, {
      ownerId: userId,
      accountId: cardArs,
      categoryId: food,
      amount: 6000n,
      occurredAt: '2026-09-20T15:00:00Z',
    });
    await newInstallmentPurchase(pool, {
      ownerId: userId,
      cardId,
      categoryId: food,
      installments: [{ period: '2026-09', amount: 2500n }],
    });

    const scope = await readScope(userId);
    const clock = new FixedClock(NOW);
    const context = await prepareDashboard(
      { clock, preferences: new DrizzleReportPreferences(connection.db) },
      scope,
    );
    const section = await buildBudgets(
      {
        versions: new DrizzleBudgetVersionReader(connection.db),
        spending: new DrizzleSpendingReader(connection.db),
        clock,
      },
      scope,
      context,
    );

    const response = await call(app, 'get', '/budgets/spending', cookies);
    const listed = budgetSpendingListResponseSchema.parse(response.body);
    expect(listed.budgets.map((row) => row.spent)).toEqual(['8500']);
    expect(section.map((row) => row.spent.toString())).toEqual(['8500']);
    expect(section[0]?.percentUsed).toBe(listed.budgets[0]?.percentUsed);
  });
});
