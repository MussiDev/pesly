import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { linkTag, newAccount, newTag, newUserId, readScope } from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';
import {
  newCard,
  newChildCategory,
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newInstallmentPurchase,
  newMember,
  newMovementAt,
  newNamedCategory,
} from './flow-fixtures';

let connection: DatabaseConnection;
let useCase: GetExpensesByCategory;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  useCase = new GetExpensesByCategory({
    clock: new FixedClock(new Date('2026-12-15T16:00:00.000Z')),
    preferences: new FakePreferences(),
    filters: new DrizzleReportFilterReader(connection.db),
    flows: new DrizzleFlowReader(connection.db),
  });
});

afterAll(async () => {
  await connection.pool.end();
});

describe('GetExpensesByCategory against PostgreSQL', () => {
  it('equals the hand-computed values for a parent, two children, a share and an installment', async () => {
    const ana = await newUserId(connection.db);
    const scope = await readScope(ana);
    const ars = await newAccount(connection.pool, ana, false, 'ARS');
    const usd = await newAccount(connection.pool, ana, false, 'USD');
    const food = await newNamedCategory(connection.pool, ana, { name: 'Food' });
    const groceries = await newChildCategory(connection.pool, ana, food);
    const snacks = await newChildCategory(connection.pool, ana, food);
    const travel = await newNamedCategory(connection.pool, ana, { name: 'Travel' });
    const at = (categoryId: string, amount: bigint, occurredAt: string, accountId = ars) =>
      newMovementAt(connection.pool, {
        ownerId: ana,
        accountId,
        categoryId,
        amount,
        occurredAt,
        rate: 14000000n,
      });
    await at(food, 1000000n, '2026-10-02T15:00:00Z');
    const tagged = await at(groceries, 2000000n, '2026-10-03T15:00:00Z');
    await at(snacks, 500000n, '2026-10-04T15:00:00Z');
    await at(travel, 2000n, '2026-10-05T15:00:00Z', usd);
    await at(food, 99n, '2026-09-30T15:00:00Z');
    const tag = await newTag(connection.pool, ana, 'vacations2026');
    await linkTag(connection.pool, { movementId: tagged, tagId: tag, ownerId: ana, position: 0 });

    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, ana);
    const other = await newMember(connection.pool, group, null);
    await newGroupExpense(connection.pool, {
      groupId: group,
      payerMemberId: other,
      categoryId: await newGroupCategory(connection.pool, group, { name: 'food' }),
      amount: 3000000n,
      occurredAt: '2026-10-05T15:00:00Z',
      shares: [
        { memberId: me, amount: 1000000n },
        { memberId: other, amount: 2000000n },
      ],
    });

    const card = await newCard(connection.pool, {
      ownerId: ana,
      arsAccountId: ars,
      usdAccountId: usd,
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: ana,
      cardId: card,
      categoryId: travel,
      installments: [{ period: '2026-10', amount: 1000000n }],
    });

    const report = await useCase.execute(scope, { from: '2026-10-01', to: '2026-10-06' });

    // Food: 1,000,000 + 2,000,000 + 500,000 + the user's share of 1,000,000 = 4,500,000.
    // Travel: 20.00 USD frozen at 1,400.0000 = 28,000.00 ARS = 2,800,000 minor units.
    expect(report.categories).toEqual([
      { categoryId: food, name: 'Food', defaultKey: null, amount: '4500000' },
      { categoryId: travel, name: 'Travel', defaultKey: null, amount: '2800000' },
    ]);
    expect(report.total).toBe('7300000');
    expect(report.unconvertedShareCount).toBe(0);
    expect(report.unconvertedInstallmentCount).toBe(0);

    const byTag = await useCase.execute(scope, {
      from: '2026-10-01',
      to: '2026-10-06',
      tag: 'Vacations2026',
    });
    expect(byTag.categories).toEqual([
      { categoryId: food, name: 'Food', defaultKey: null, amount: '2000000' },
    ]);

    const november = await useCase.execute(scope, { from: '2026-11-01', to: '2026-11-30' });
    expect(november.categories).toEqual([
      { categoryId: travel, name: 'Travel', defaultKey: null, amount: '1000000' },
    ]);
  });
});
