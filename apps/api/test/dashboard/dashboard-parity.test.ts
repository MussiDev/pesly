import {
  budgetSpendingListResponseSchema,
  dashboardResponseSchema,
  expensesByCategoryResponseSchema,
  netWorthResponseSchema,
} from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { FixedClock } from './fakes';
import { addRealUser, buildRealApp, getJson } from './real-app';
import { seedGroup, seedRate, seedWorld } from './world-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

/** 2026-10-10: every installment of October is already due, the condition of AC-47. */
const AFTER_DUE = new Date('2026-10-10T16:00:00.000Z');

describe('the dashboard against the 09a reports and the budgets endpoint', () => {
  it('(AC-47) month expenses equal the expenses report and the ARS and USD parts the last net worth point', async () => {
    const { app } = buildRealApp(connection, new FixedClock(AFTER_DUE));
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    const bea = await addRealUser(connection, app, 'bea');
    await seedWorld(connection, ana.id, 'ana');
    await seedGroup(connection.pool, ana.id, bea.id);

    const dashboard = dashboardResponseSchema.parse(
      (await getJson(app, '/dashboard', ana.cookies)).body,
    );
    const expenses = expensesByCategoryResponseSchema.parse(
      (
        await getJson(
          app,
          '/reports/expenses-by-category?from=2026-10-01&to=2026-10-10',
          ana.cookies,
        )
      ).body,
    );
    const netWorth = netWorthResponseSchema.parse(
      (await getJson(app, '/reports/net-worth?from=2026-10-01&to=2026-10-10', ana.cookies)).body,
    );

    expect(dashboard.today).toBe('2026-10-10');
    expect(expenses.total).not.toBe('0');
    // The report counts unpaid card statements in their due month; the dashboard month shows them
    // apart as pending on cards (FEAT-015), so the two add up to the report.
    expect(dashboard.month.pendingCard.amount).not.toBe('0');
    expect(
      (BigInt(dashboard.month.expenses) + BigInt(dashboard.month.pendingCard.amount)).toString(),
    ).toBe(expenses.total);
    const last = netWorth.points.at(-1);
    expect(last?.date).toBe('2026-10-10');
    // The 09a chart values the investments from snapshots (none here); the dashboard values them live.
    const investments = dashboard.netWorth.parts.investments;
    expect(dashboard.netWorth.ars).not.toBe(investments.ars);
    expect((BigInt(dashboard.netWorth.ars) - BigInt(investments.ars)).toString()).toBe(last?.ars);
    expect((BigInt(dashboard.netWorth.usd) - BigInt(investments.usd)).toString()).toBe(last?.usd);
  });

  it('(AC-48) each budget percentage equals the one of the budgets endpoint', async () => {
    const { app } = buildRealApp(connection);
    await seedRate(connection.pool);
    const ana = await addRealUser(connection, app, 'ana');
    await seedWorld(connection, ana.id, 'ana');

    const dashboard = dashboardResponseSchema.parse(
      (await getJson(app, '/dashboard', ana.cookies)).body,
    );
    const listed = budgetSpendingListResponseSchema.parse(
      (await getJson(app, '/budgets/spending', ana.cookies)).body,
    );

    expect(dashboard.budgets).toHaveLength(2);
    const byId = new Map(listed.budgets.map((row) => [row.budgetId, row]));
    for (const row of dashboard.budgets) {
      expect(row.percentUsed).toBe(byId.get(row.budgetId)?.percentUsed);
      expect(row.spent).toBe(byId.get(row.budgetId)?.spent);
    }
  });
});
