import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetIncomeExpenses } from '../../src/reports/application/get-income-expenses';
import { presentIncomeExpenses } from '../../src/reports/infrastructure/http/present-income-expenses';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  linkTag,
  newAccount,
  newCategory,
  newExchange,
  newTag,
  newTransfer,
  newUserId,
  readScope,
} from '../movements/db-fixtures';
import { FakeFilterReader, FakePreferences, FixedClock } from './fakes';
import { newCard, newInstallmentPurchase, newMovementAt, newStatement } from './flow-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

let connection: DatabaseConnection;
let reader: DrizzleFlowReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleFlowReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function useCaseFor(filters: FakeFilterReader, now?: Date) {
  return new GetIncomeExpenses({
    clock: new FixedClock(now),
    preferences: new FakePreferences({
      displayCurrency: 'ARS',
      defaultRateType: 'mep',
      timeZone: BUENOS_AIRES,
    }),
    filters,
    flows: reader,
    present: presentIncomeExpenses,
  });
}

async function world() {
  const ana = await newUserId(connection.db, { timeZone: BUENOS_AIRES });
  return {
    ana,
    scope: await readScope(ana),
    ars: await newAccount(connection.pool, ana, false, 'ARS'),
    ars2: await newAccount(connection.pool, ana, false, 'ARS'),
    usd: await newAccount(connection.pool, ana, false, 'USD'),
    food: await newCategory(connection.pool, ana, 'expense'),
    salary: await newCategory(connection.pool, ana, 'income'),
  };
}

describe('income and expenses over PostgreSQL', () => {
  it('matches the hand-computed values over a seeded two-month fixture', async () => {
    const w = await world();
    const at = (occurredAt: string) => ({ ownerId: w.ana, occurredAt });
    await newMovementAt(connection.pool, {
      ...at('2026-09-05T15:00:00Z'),
      accountId: w.ars,
      categoryId: w.salary,
      type: 'income',
      amount: 1000000n,
    });
    await newMovementAt(connection.pool, {
      ...at('2026-09-20T15:00:00Z'),
      accountId: w.ars,
      categoryId: w.food,
      amount: 250000n,
    });
    // 20.00 USD at a frozen 1,400.0000: 28,000.00 ARS.
    await newMovementAt(connection.pool, {
      ...at('2026-10-02T15:00:00Z'),
      accountId: w.usd,
      categoryId: w.food,
      amount: 2000n,
      rate: 14000000n,
    });
    await newMovementAt(connection.pool, {
      ...at('2026-10-03T15:00:00Z'),
      accountId: w.ars,
      categoryId: w.food,
      amount: 100000n,
    });
    // 2026-10-01 00:30 in Buenos Aires is 03:30 UTC; 2026-09-30T23:30 local belongs to September.
    await newMovementAt(connection.pool, {
      ...at('2026-10-01T02:30:00Z'),
      accountId: w.ars,
      categoryId: w.food,
      amount: 5n,
    });
    // Transfers and exchanges change neither income nor expenses (AC-22).
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: w.ars2,
      amount: 77000n,
    });
    await newExchange(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: w.usd,
      amount: 1400000n,
      destinationAmount: 1000n,
      rate: 14000000n,
    });
    // Another user never leaks in.
    const bea = await newUserId(connection.db, { timeZone: BUENOS_AIRES });
    const beaAccount = await newAccount(connection.pool, bea, false, 'ARS');
    const beaFood = await newCategory(connection.pool, bea, 'expense');
    await newMovementAt(connection.pool, {
      ownerId: bea,
      accountId: beaAccount,
      categoryId: beaFood,
      amount: 999999n,
      occurredAt: '2026-10-03T15:00:00Z',
    });

    const response = await useCaseFor(new FakeFilterReader()).execute(w.scope, {
      from: '2026-09-01',
      to: '2026-10-06',
    });

    expect(response.months).toEqual([
      { month: '2026-09', income: '1000000', expenses: '250005' },
      { month: '2026-10', income: '0', expenses: '2900000' },
    ]);
  });

  it('filters by account and by tag and skips shares and installments (AC-12, AC-24)', async () => {
    const w = await world();
    const mine = await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.food,
      amount: 1000n,
      occurredAt: '2026-10-02T15:00:00Z',
    });
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars2,
      categoryId: w.food,
      amount: 40n,
      occurredAt: '2026-10-02T15:00:00Z',
    });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: w.ars2,
      amount: 5000n,
    });
    const tag = await newTag(connection.pool, w.ana, 'Vacations2026');
    await linkTag(connection.pool, { movementId: mine, tagId: tag, ownerId: w.ana, position: 0 });
    const card = await newCard(connection.pool, {
      ownerId: w.ana,
      arsAccountId: w.ars,
      usdAccountId: w.usd,
    });
    await newStatement(connection.pool, {
      cardId: card,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-02',
      dueDate: '2026-10-10',
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: card,
      categoryId: w.food,
      installments: [{ period: '2026-10', amount: 3000n }],
    });
    const useCase = useCaseFor(
      new FakeFilterReader([w.ars], ['Vacations2026']),
      new Date('2026-10-31T15:00:00Z'),
    );
    const query = { from: '2026-10-01', to: '2026-10-31' };

    const byAccount = await useCase.execute(w.scope, { ...query, accountId: w.ars });
    const byTag = await useCase.execute(w.scope, { ...query, tag: 'vacations2026' });

    expect(byAccount.months).toEqual([{ month: '2026-10', income: '0', expenses: '1000' }]);
    expect(byTag.months).toEqual([{ month: '2026-10', income: '0', expenses: '1000' }]);
  });

  it('adds the installments of the due month to the expenses (AC-23)', async () => {
    const w = await world();
    const card = await newCard(connection.pool, {
      ownerId: w.ana,
      arsAccountId: w.ars,
      usdAccountId: w.usd,
    });
    await newStatement(connection.pool, {
      cardId: card,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-25',
      dueDate: '2026-11-10',
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: card,
      categoryId: w.food,
      installments: [
        { period: '2026-10', amount: 1000000n },
        // No stored statement: derived, closing 25 and due 10 put 2026-11 due on 2026-12-10.
        { period: '2026-11', amount: 555n },
      ],
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: card,
      categoryId: w.food,
      currency: 'USD',
      installments: [{ period: '2026-10', amount: 4000n }],
    });
    const useCase = useCaseFor(new FakeFilterReader(), new Date('2026-12-20T15:00:00Z'));

    const result = await useCase.execute(w.scope, { from: '2026-11-01', to: '2026-12-20' });

    expect(result.months).toEqual([
      { month: '2026-11', income: '0', expenses: '1000000' },
      { month: '2026-12', income: '0', expenses: '555' },
    ]);
    expect(result.unconvertedInstallmentCount).toBe(1);
  });
});
