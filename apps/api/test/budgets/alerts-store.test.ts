import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AlertCrossing } from '../../src/budgets/application/ports/budget-alert-store';
import { DrizzleBudgetAlertStore } from '../../src/budgets/infrastructure/db/drizzle-budget-alert-store';
import { createBudgetAlertListener } from '../../src/budgets/infrastructure/budget-alert-listener';
import { renderBudgetAlertText } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, writeScope } from '../movements/db-fixtures';
import { newBudgetWithVersions } from './spending-fixtures';

let connection: DatabaseConnection;
let store: DrizzleBudgetAlertStore;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  store = new DrizzleBudgetAlertStore(connection.db, renderBudgetAlertText);
});

afterAll(async () => {
  await connection.pool.end();
});

async function world(name = 'Outings') {
  const ownerId = await newUserId(connection.db);
  const food = await newCategory(connection.pool, ownerId, 'expense');
  const budgetId = await newBudgetWithVersions(connection.pool, {
    ownerId,
    versions: [{ effectiveFrom: '2026-10-01', amount: 15000000n, categoryIds: [food], name }],
  });
  return { ownerId, food, budgetId, scope: await writeScope(ownerId) };
}

function crossing(budgetId: string, threshold = 80, over: Partial<AlertCrossing> = {}) {
  return { budgetId, budgetName: 'Outings', month: '2026-10-01', threshold, ...over };
}

async function marksOf(budgetId: string) {
  const result = await connection.pool.query<{ id: string; threshold: number }>(
    'select id, threshold from budget_alert_marks where budget_id = $1 order by threshold',
    [budgetId],
  );
  return result.rows;
}

async function noticesOf(ownerId: string) {
  const result = await connection.pool.query<{
    kind: string;
    payment_id: string;
    due_date: string;
    text: string;
  }>(
    `select kind, payment_id, to_char(due_date, 'YYYY-MM-DD') as due_date, text
       from notices where owner_id = $1 order by created_at, text`,
    [ownerId],
  );
  return result.rows;
}

describe('DrizzleBudgetAlertStore.publish', () => {
  it('stores a budget_alert notice with the mark id, the first day, the owner language and no amount (AC-15, AC-17)', async () => {
    const w = await world();

    const created = await store.publish(w.scope, [crossing(w.budgetId)]);

    const [mark] = await marksOf(w.budgetId);
    const [notice] = await noticesOf(w.ownerId);
    expect(created).toBe(1);
    expect(notice).toEqual({
      kind: 'budget_alert',
      payment_id: mark?.id,
      due_date: '2026-10-01',
      text: 'Outings alcanzó el 80% de su presupuesto',
    });
    expect(notice?.text).not.toMatch(/\$|ARS|15000000/);
  });

  it('writes the English text for an English user', async () => {
    const w = await world();
    await connection.pool.query("update users set language = 'en' where id = $1", [w.ownerId]);

    await store.publish(w.scope, [crossing(w.budgetId)]);

    expect((await noticesOf(w.ownerId))[0]?.text).toBe('Outings reached 80% of its budget');
  });

  it('creates exactly one mark and one notice for two concurrent calls (AC-13)', async () => {
    const w = await world();

    const results = await Promise.all([
      store.publish(w.scope, [crossing(w.budgetId)]),
      store.publish(w.scope, [crossing(w.budgetId)]),
    ]);

    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await marksOf(w.budgetId)).toHaveLength(1);
    expect(await noticesOf(w.ownerId)).toHaveLength(1);
  });

  it('publishes only the new crossings of a call and returns how many (AC-05)', async () => {
    const w = await world();
    await store.publish(w.scope, [crossing(w.budgetId, 80)]);

    const created = await store.publish(w.scope, [
      crossing(w.budgetId, 80),
      crossing(w.budgetId, 100),
    ]);

    expect(created).toBe(1);
    expect((await marksOf(w.budgetId)).map((m) => m.threshold)).toEqual([80, 100]);
    expect(await noticesOf(w.ownerId)).toHaveLength(2);
  });

  it('marks a new month again (AC-14)', async () => {
    const w = await world();
    await store.publish(w.scope, [crossing(w.budgetId)]);

    const created = await store.publish(w.scope, [
      crossing(w.budgetId, 80, { month: '2026-11-01' }),
    ]);

    expect(created).toBe(1);
    expect(await marksOf(w.budgetId)).toHaveLength(2);
  });

  it('rolls the mark back when the notice cannot be written, so the next call publishes it (AC-13)', async () => {
    const w = await world();
    let fail = true;
    const flaky = new DrizzleBudgetAlertStore(connection.db, (input) => {
      if (fail) throw new Error('forced');
      return renderBudgetAlertText(input);
    });

    await expect(flaky.publish(w.scope, [crossing(w.budgetId)])).rejects.toThrow('forced');
    expect(await marksOf(w.budgetId)).toEqual([]);
    expect(await noticesOf(w.ownerId)).toEqual([]);

    fail = false;
    expect(await flaky.publish(w.scope, [crossing(w.budgetId)])).toBe(1);
  });

  it('rejects a crossing of a budget of another user and writes nothing (AC-19)', async () => {
    const mine = await world();
    const other = await world();

    await expect(store.publish(mine.scope, [crossing(other.budgetId)])).rejects.toThrow();

    expect(await marksOf(other.budgetId)).toEqual([]);
    expect(await noticesOf(other.ownerId)).toEqual([]);
    expect(await noticesOf(mine.ownerId)).toEqual([]);
  });

  it('does nothing for an empty list', async () => {
    const w = await world();
    expect(await store.publish(w.scope, [])).toBe(0);
  });

  it('removes the marks with the budget and alerts a new budget as new (AC-22)', async () => {
    const w = await world();
    await store.publish(w.scope, [crossing(w.budgetId)]);
    await connection.pool.query('delete from budgets where id = $1', [w.budgetId]);
    expect(await marksOf(w.budgetId)).toEqual([]);

    const again = await newBudgetWithVersions(connection.pool, {
      ownerId: w.ownerId,
      versions: [{ effectiveFrom: '2026-10-01', amount: 15000000n, categoryIds: [w.food] }],
    });

    expect(await store.publish(w.scope, [crossing(again)])).toBe(1);
    expect(await noticesOf(w.ownerId)).toHaveLength(2);
  });
});

describe('createBudgetAlertListener', () => {
  it('evaluates the current month against PostgreSQL and publishes the 80 crossing (AC-01)', async () => {
    const w = await world();
    const account = await connection.pool.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ($1, 'Caja', 'cash', 'ARS', 0, true) returning id`,
      [w.ownerId],
    );
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 12000000, '2026-10-05T15:00:00Z', 14000000, 'manual')`,
      [w.ownerId, account.rows[0]?.id, w.food],
    );
    const listener = createBudgetAlertListener(connection.db, {
      renderText: renderBudgetAlertText,
      clock: { now: () => new Date('2026-10-06T16:00:00Z') },
    });

    await listener.afterExpenseSaved(w.scope, {
      categoryId: w.food,
      occurredAt: new Date('2026-10-05T15:00:00Z'),
    });

    expect((await marksOf(w.budgetId)).map((m) => m.threshold)).toEqual([80]);
    expect(await noticesOf(w.ownerId)).toHaveLength(1);
  });

  it('rethrows a database error instead of swallowing it (AC-18)', async () => {
    const w = await world();
    const listener = createBudgetAlertListener(connection.db, {
      renderText: renderBudgetAlertText,
      clock: {
        now: () => {
          throw new Error('clock failed');
        },
      },
    });

    await expect(
      listener.afterExpenseSaved(w.scope, { categoryId: w.food, occurredAt: new Date() }),
    ).rejects.toThrow('clock failed');
  });
});
