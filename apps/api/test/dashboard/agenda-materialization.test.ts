import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/dashboard/application/build-agenda';
import { ContextTimeZones } from '../../src/dashboard/application/context-time-zones';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import type { AccountCurrencyReader } from '../../src/dashboard/application/ports/account-currency-reader';
import { DrizzleAccountCurrencyReader } from '../../src/dashboard/infrastructure/db/drizzle-account-currency-reader';
import {
  DrizzleOccurrenceRepository,
  DrizzleRecurringPaymentRepository,
  ListUpcoming,
} from '../../src/recurring';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newRecurringOwner, rentOf } from '../recurring/fixtures';
import { readScope, writeScope } from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('agenda materialization (FR-09)', () => {
  it('materializes the pending occurrence like the upcoming list, idempotently, and reads currencies once', async () => {
    const owner = await newRecurringOwner(connection.db, connection.pool);
    await new DrizzleRecurringPaymentRepository(connection.db).create(
      await writeScope(owner.ownerId),
      rentOf(owner, { dayOfMonth: 5, startDate: '2026-10-05', scheduleFrom: '2026-10-05' }),
    );
    const clock = new FixedClock();
    const scope = await readScope(owner.ownerId);
    const context = await prepareDashboard({ clock, preferences: new FakePreferences() }, scope);
    const currencyCalls: number[] = [];
    const currencies: AccountCurrencyReader = {
      currenciesOf: (...args) => {
        currencyCalls.push(args[1].length);
        return new DrizzleAccountCurrencyReader(connection.db).currenciesOf(...args);
      },
    };
    const deps = {
      upcoming: (ctx: typeof context) =>
        new ListUpcoming({
          payments: new DrizzleRecurringPaymentRepository(connection.db),
          occurrences: new DrizzleOccurrenceRepository(connection.db),
          timeZones: new ContextTimeZones(ctx.userId, ctx.preferences.timeZone),
          clock,
        }),
      currencies,
      statements: { dueStatements: () => Promise.resolve([]) },
    };

    const first = await buildAgenda(deps, scope, context);
    const second = await buildAgenda(deps, scope, context);

    const rows = await connection.pool.query<{ n: number }>(
      'select count(*)::int as n from recurring_occurrences where owner_id = $1',
      [owner.ownerId],
    );
    expect(rows.rows[0]?.n).toBe(1);
    expect(first.actions).toEqual(second.actions);
    expect(first.actions).toEqual([
      expect.objectContaining({ kind: 'overdue_occurrence', dueDate: '2026-10-05', name: 'Rent' }),
    ]);
    expect(currencyCalls).toEqual([1, 1]);
  });
});
