import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { CreateInstallmentPurchase } from '../../src/credit-cards/application/create-installment-purchase';
import {
  ImportCardStatement,
  type StatementImportInput,
  type StatementImportLineInput,
} from '../../src/credit-cards/application/import-card-statement';
import { InvalidFirstPeriod } from '../../src/credit-cards/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeActivity,
  FakeCardPurchases,
  FakeClock,
  FakeExpenseRecorder,
  FakeTimeZones,
  InMemoryCreditCards,
  installmentFakes,
  writeScopeFor,
} from './fakes';

const ANA = 'ana';
const BOB = 'bob';
const FOOD = '7c1d6c6e-7f0e-4d57-9a53-6a1b5d7d1a11';

function setup(now = '2026-10-06T15:00:00.000Z') {
  const cards = new InMemoryCreditCards();
  const clock = new FakeClock(new Date(now));
  const recorder = new FakeExpenseRecorder(clock);
  const fakes = installmentFakes();
  const deps = {
    cards,
    activity: new FakeActivity(),
    timeZones: new FakeTimeZones(),
    clock,
    purchases: new FakeCardPurchases(recorder),
    expenses: recorder,
    ...fakes,
  };
  const create = new CreateInstallmentPurchase(deps);
  return {
    ...fakes,
    cards,
    recorder,
    createCard: new CreateCreditCard(deps),
    create,
    importer: new ImportCardStatement(deps, create),
  };
}

async function withCard(now?: string) {
  const app = setup(now);
  const card = await app.createCard.execute(await writeScopeFor(ANA), {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
  });
  return { app, card };
}

function line(overrides: Partial<StatementImportLineInput> = {}): StatementImportLineInput {
  return {
    date: '2026-09-10',
    description: 'Tienda',
    voucher: '000111*',
    currency: 'ARS',
    amount: 10000n,
    installmentNumber: null,
    installmentCount: null,
    ...overrides,
  };
}

function statement(lines: StatementImportLineInput[]): StatementImportInput {
  return { closingDate: '2026-09-24', dueDate: '2026-10-05', categoryId: FOOD, lines };
}

describe('ImportCardStatement', () => {
  it('turns plain lines into card expenses and installment lines into installment purchases', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);

    const result = await app.importer.execute(
      scope,
      card.id,
      statement([
        line({ description: 'Super' }),
        line({ description: 'Servicio', currency: 'USD', amount: 2000n }),
        line({
          description: 'Heladera',
          amount: 733997n,
          installmentNumber: 5,
          installmentCount: 6,
          date: '2026-04-30',
        }),
      ]),
    );

    expect(result).toEqual({
      created: 3,
      skipped: 0,
      createdExpenses: 2,
      createdInstallmentPurchases: 1,
    });
    const [ars, usd] = app.recorder.expenses;
    expect(ars).toMatchObject({ accountId: card.arsAccountId, amount: 10000n, note: 'Super' });
    expect(usd).toMatchObject({ accountId: card.usdAccountId, amount: 2000n });
    expect(app.recorder.unmetered).toBe(2);
  });

  it('anchors installment N on the imported statement and splits the total by the count', async () => {
    const { app, card } = await withCard();

    await app.importer.execute(
      await writeScopeFor(ANA),
      card.id,
      statement([
        line({
          amount: 733997n,
          installmentNumber: 5,
          installmentCount: 6,
          date: '2026-04-30',
          currency: 'USD',
        }),
      ]),
    );

    const [row] = [...app.installments.purchases.values()];
    const purchase = row?.purchase;
    expect(purchase).toMatchObject({
      totalAmount: 733997n * 6n,
      installmentCount: 6,
      purchasedOn: '2026-04-30',
      currency: 'USD',
    });
    expect(purchase?.installments.map((i) => i.period)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(purchase?.installments[4]).toMatchObject({ number: 5, amount: 733997n });
  });

  it('skips every line when the same file is imported again', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const input = statement([
      line(),
      line({ description: 'Cuotas', installmentNumber: 1, installmentCount: 3 }),
    ]);

    await app.importer.execute(scope, card.id, input);
    const again = await app.importer.execute(scope, card.id, input);

    expect(again).toEqual({
      created: 0,
      skipped: 2,
      createdExpenses: 0,
      createdInstallmentPurchases: 0,
    });
    expect(app.recorder.expenses).toHaveLength(1);
    expect(app.installments.purchases.size).toBe(1);
  });

  it('keeps identical repeated purchases of one file as separate expenses', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const input = statement([line(), line(), line()]);

    const first = await app.importer.execute(scope, card.id, input);
    const second = await app.importer.execute(scope, card.id, input);

    expect(first.created).toBe(3);
    expect(second).toMatchObject({ created: 0, skipped: 3 });
    expect(app.recorder.expenses).toHaveLength(3);
  });

  it('creates only the new lines when a bigger file contains an earlier import', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    await app.importer.execute(scope, card.id, statement([line()]));

    const result = await app.importer.execute(
      scope,
      card.id,
      statement([line(), line({ description: 'Nueva' })]),
    );

    expect(result).toMatchObject({ created: 1, skipped: 1 });
  });

  it('spends one write limit unit for the whole import', async () => {
    const { app, card } = await withCard();
    const lines = Array.from({ length: 25 }, (_, index) => line({ amount: BigInt(100 + index) }));

    await app.importer.execute(await writeScopeFor(ANA), card.id, statement(lines));

    expect(app.writeLimit.taken).toBe(1);
    expect(app.writeLimit.released).toBe(0);
  });

  it('is rate limited by the same budget as single creations', async () => {
    const { app, card } = await withCard();
    app.writeLimit.limit = 0;

    await expect(
      app.importer.execute(await writeScopeFor(ANA), card.id, statement([line()])),
    ).rejects.toThrow('RATE_LIMITED');
    expect(app.recorder.expenses).toHaveLength(0);
  });

  it('answers a missing or foreign card with not found before storing anything', async () => {
    const { app, card } = await withCard();

    await expect(
      app.importer.execute(await writeScopeFor(BOB), card.id, statement([line()])),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      app.importer.execute(
        await writeScopeFor(ANA),
        '00000000-0000-4000-8000-000000000000',
        statement([line()]),
      ),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(app.writeLimit.taken).toBe(0);
    expect(app.statementImports.claimed.size).toBe(0);
  });

  it('rejects a category that is not an open expense one before taking a unit', async () => {
    const { app, card } = await withCard();
    app.categories.rejected.set(FOOD, new Error('CATEGORY_NOT_ALLOWED'));

    await expect(
      app.importer.execute(await writeScopeFor(ANA), card.id, statement([line()])),
    ).rejects.toThrow('CATEGORY_NOT_ALLOWED');
    expect(app.writeLimit.taken).toBe(0);
    expect(app.statementImports.claimed.size).toBe(0);
  });

  it('gives the claim and the unit back when the first line fails, and a retry imports everything', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const input = statement([line(), line({ description: 'Otra' })]);
    app.recorder.failWith = new Error('boom');

    await expect(app.importer.execute(scope, card.id, input)).rejects.toThrow('boom');
    expect(app.statementImports.claimed.size).toBe(0);
    expect(app.writeLimit.released).toBe(1);

    app.recorder.failWith = null;
    const retry = await app.importer.execute(scope, card.id, input);
    expect(retry).toMatchObject({ created: 2, skipped: 0 });
  });

  it('keeps the earlier lines and the unit when a later line fails, and a retry creates the missing ones', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const input = statement([
      line({ description: 'Uno' }),
      line({ description: 'Dos', date: '2026-11-30' }),
      line({ description: 'Tres' }),
    ]);

    // The second line is dated after today, which the movements rules refuse.
    await expect(app.importer.execute(scope, card.id, input)).rejects.toThrow();
    expect(app.recorder.expenses).toHaveLength(1);
    expect(app.writeLimit.released).toBe(0);

    const fixed = statement([
      line({ description: 'Uno' }),
      line({ description: 'Dos' }),
      line({ description: 'Tres' }),
    ]);
    const retry = await app.importer.execute(scope, card.id, fixed);
    expect(retry).toMatchObject({ created: 2, skipped: 1 });
  });

  it('dates a line of today at the current instant so it is never in the future', async () => {
    const { app, card } = await withCard('2026-10-06T13:00:00.000Z');

    await app.importer.execute(
      await writeScopeFor(ANA),
      card.id,
      statement([line({ date: '2026-10-06' })]),
    );

    expect(app.recorder.expenses[0]?.occurredAt.toISOString()).toBe('2026-10-06T13:00:00.000Z');
  });

  it('creates the cycles from an imported statement older than the first stored one', async () => {
    const { app, card } = await withCard();

    await app.importer.execute(await writeScopeFor(ANA), card.id, {
      ...statement([line({ date: '2026-08-10' })]),
      closingDate: '2026-08-22',
      dueDate: '2026-09-03',
    });

    const periods = [...app.cards.statements.values()]
      .filter((item) => item.cardId === card.id)
      .sort((a, b) => a.period.localeCompare(b.period));
    expect(periods.map((item) => item.period).slice(0, 3)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(periods[0]).toMatchObject({ closingDate: '2026-08-22', dueDate: '2026-09-03' });
    expect(periods[1]).toMatchObject({ closingDate: '2026-09-24' });
  });
});

describe('CreateInstallmentPurchase firstPeriod', () => {
  it('rejects a first period that is not a YYYY-MM month', async () => {
    const { app, card } = await withCard();

    await expect(
      app.create.execute(await writeScopeFor(ANA), card.id, {
        categoryId: FOOD,
        currency: 'ARS',
        amount: 30000n,
        installments: 3,
        purchasedOn: '2026-10-01',
        firstPeriod: '2026-13',
      }),
    ).rejects.toBeInstanceOf(InvalidFirstPeriod);
    expect(app.installments.purchases.size).toBe(0);
  });

  it('uses the first period instead of the statement of the purchase day', async () => {
    const { app, card } = await withCard();

    const created = await app.create.execute(await writeScopeFor(ANA), card.id, {
      categoryId: FOOD,
      currency: 'ARS',
      amount: 30000n,
      installments: 3,
      purchasedOn: '2026-10-01',
      firstPeriod: '2026-07',
    });

    expect(created.installments.map((i) => i.period)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});
