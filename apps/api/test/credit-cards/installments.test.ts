import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { CreateInstallmentPurchase } from '../../src/credit-cards/application/create-installment-purchase';
import { DeleteCreditCard } from '../../src/credit-cards/application/delete-credit-card';
import { DeleteInstallmentPurchase } from '../../src/credit-cards/application/delete-installment-purchase';
import { GetInstallmentPurchase } from '../../src/credit-cards/application/get-installment-purchase';
import { ListInstallmentExpenses } from '../../src/credit-cards/application/list-installment-expenses';
import { ListInstallmentPurchases } from '../../src/credit-cards/application/list-installment-purchases';
import { ListStatements } from '../../src/credit-cards/application/list-statements';
import { RecordCardExpense } from '../../src/credit-cards/application/record-card-expense';
import { UpdateInstallmentPurchase } from '../../src/credit-cards/application/update-installment-purchase';
import {
  CardHasMovements,
  InstallmentPurchaseDateInFuture,
} from '../../src/credit-cards/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeActivity,
  FakeCardPurchases,
  FakeClock,
  FakeExpenseRecorder,
  FakeTimeZones,
  InMemoryCreditCards,
  installmentFakes,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ANA = 'ana';
const BOB = 'bob';
const FOOD = '7c1d6c6e-7f0e-4d57-9a53-6a1b5d7d1a11';
const HOME = '7c1d6c6e-7f0e-4d57-9a53-6a1b5d7d1a12';

function setup(now = '2026-10-06T12:00:00.000Z') {
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
  return {
    ...fakes,
    cards,
    clock,
    createCard: new CreateCreditCard(deps),
    deleteCard: new DeleteCreditCard(deps),
    statements: new ListStatements(deps),
    recordExpense: new RecordCardExpense(deps),
    create: new CreateInstallmentPurchase(deps),
    list: new ListInstallmentPurchases(deps),
    get: new GetInstallmentPurchase(deps),
    update: new UpdateInstallmentPurchase(deps),
    remove: new DeleteInstallmentPurchase(deps),
    monthly: new ListInstallmentExpenses(deps),
  };
}

const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };

async function withCard(now?: string) {
  const app = setup(now);
  const card = await app.createCard.execute(await writeScopeFor(ANA), visa);
  return { app, card };
}

function purchase(
  amount: bigint,
  installments: number,
  purchasedOn = '2026-10-06',
  categoryId = FOOD,
) {
  return { categoryId, amount, installments, purchasedOn };
}

describe('CreateInstallmentPurchase', () => {
  it('stores 120,000.00 ARS in 12 installments of 10,000.00 ARS (AC-01)', async () => {
    const { app, card } = await withCard();

    const created = await app.create.execute(
      await writeScopeFor(ANA),
      card.id,
      purchase(12000000n, 12),
    );

    expect(created.installmentCount).toBe(12);
    expect(created.installments).toHaveLength(12);
    expect(created.installments.every((i) => i.amount === 1000000n)).toBe(true);
    expect(created.installments[0]).toMatchObject({ number: 1, period: '2026-10', status: 'open' });
  });

  it('gives 33.34, 33.33 and 33.33 ARS for 100.00 ARS in 3 installments (AC-04)', async () => {
    const { app, card } = await withCard();

    const created = await app.create.execute(
      await writeScopeFor(ANA),
      card.id,
      purchase(10000n, 3),
    );

    expect(created.installments.map((i) => i.amount)).toEqual([3334n, 3333n, 3333n]);
  });

  it('assigns the installments to the statements closing 2026-10-24, 2026-11-24 and 2026-12-24 (AC-05)', async () => {
    const { app, card } = await withCard();

    const created = await app.create.execute(
      await writeScopeFor(ANA),
      card.id,
      purchase(30000n, 3, '2026-10-06'),
    );

    expect(created.installments.map((i) => i.closingDate)).toEqual([
      '2026-10-24',
      '2026-11-24',
      '2026-12-24',
    ]);
    expect(created.installments.map((i) => i.dueDate)).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('starts in the next statement for a purchase after the closing date', async () => {
    const { app, card } = await withCard('2026-10-26T12:00:00.000Z');
    const scope = await writeScopeFor(ANA);

    const created = await app.create.execute(scope, card.id, purchase(30000n, 3, '2026-10-25'));

    expect(created.installments.map((i) => i.period)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('refuses a future date, an archived or foreign category and stores nothing (sad path)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    app.categories.rejected.set(HOME, new Error('CATEGORY_ARCHIVED'));

    await expect(
      app.create.execute(scope, card.id, purchase(30000n, 3, '2026-10-07')),
    ).rejects.toBeInstanceOf(InstallmentPurchaseDateInFuture);
    await expect(
      app.create.execute(scope, card.id, purchase(30000n, 3, '2026-10-06', HOME)),
    ).rejects.toThrow('CATEGORY_ARCHIVED');
    expect(app.installments.purchases.size).toBe(0);
    expect(app.writeLimit.released).toBe(2);
  });

  it('refuses a card of another user before taking a unit of the limit (sad path)', async () => {
    const { app, card } = await withCard();

    await expect(
      app.create.execute(await writeScopeFor(BOB), card.id, purchase(30000n, 3)),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(app.writeLimit.taken).toBe(0);
    expect(app.installments.purchases.size).toBe(0);
  });

  it('stores nothing when the write limit refuses, and refunds the unit when the store fails (sad path)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    app.writeLimit.limit = 0;
    app.writeLimit.exhausted = new Error('RATE_LIMITED');

    await expect(app.create.execute(scope, card.id, purchase(30000n, 3))).rejects.toThrow(
      'RATE_LIMITED',
    );
    expect(app.installments.purchases.size).toBe(0);

    app.writeLimit.limit = 5;
    app.installments.create = () => Promise.reject(new Error('database down'));
    await expect(app.create.execute(scope, card.id, purchase(30000n, 3))).rejects.toThrow(
      'database down',
    );
    expect(app.writeLimit.taken).toBe(1);
    expect(app.writeLimit.released).toBe(1);
  });
});

describe('statements with installments', () => {
  it('adds the installment to the purchases of the statement: 60,000.00 ARS and 20.00 USD (AC-07)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const rate = { source: 'automatic' } as const;
    const base = { categoryId: FOOD, occurredAt: new Date('2026-10-06T11:00:00.000Z'), rate };
    await app.recordExpense.execute(scope, card.id, { ...base, currency: 'ARS', amount: 5000000n });
    await app.recordExpense.execute(scope, card.id, { ...base, currency: 'USD', amount: 2000n });
    await app.create.execute(scope, card.id, purchase(12000000n, 12));

    const [october] = await app.statements.execute(scope, card.id);

    expect(october?.totals).toEqual({ ARS: 6000000n, USD: 2000n });
    expect(october?.installments).toEqual([
      expect.objectContaining({ number: 1, count: 12, amount: 1000000n, categoryId: FOOD }),
    ]);
  });

  it('keeps counting the closed installments after a deletion (AC-09, FR-06)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));
    app.clock.current = new Date('2026-11-25T12:00:00.000Z');

    await app.remove.execute(scope, card.id, created.id);

    const statements = await app.statements.execute(scope, card.id);
    const byPeriod = new Map(statements.map((s) => [s.period, s]));
    expect(byPeriod.get('2026-10')?.totals.ARS).toBe(1000000n);
    expect(byPeriod.get('2026-11')?.totals.ARS).toBe(1000000n);
    expect(byPeriod.get('2026-12')?.totals.ARS).toBe(0n);
  });
});

describe('ListInstallmentPurchases', () => {
  it('shows a pending debt of 110,000.00 ARS for 11 installments in statements not yet closed (AC-08)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    await app.create.execute(scope, card.id, purchase(12000000n, 12));
    app.clock.current = new Date('2026-10-25T12:00:00.000Z');

    const { items, pendingDebt } = await app.list.execute(await readScopeFor(ANA), card.id);

    expect(items).toHaveLength(1);
    expect(items[0]?.installments[0]?.status).toBe('closed');
    expect(pendingDebt).toEqual({ ARS: 11000000n, USD: 0n });
  });

  it('shows zero pending debt for a card without purchases', async () => {
    const { app, card } = await withCard();

    const result = await app.list.execute(await readScopeFor(ANA), card.id);

    expect(result).toEqual({ items: [], pendingDebt: { ARS: 0n, USD: 0n } });
  });

  it('is not readable from another user (sad path)', async () => {
    const { app, card } = await withCard();

    await expect(app.list.execute(await readScopeFor(BOB), card.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('DeleteInstallmentPurchase', () => {
  it('removes the 10 installments of open statements and keeps the 2 of closed ones (AC-09)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));
    app.clock.current = new Date('2026-11-25T12:00:00.000Z');

    await app.remove.execute(scope, card.id, created.id);

    const rows = await app.installments.listRows(scope, card.id);
    expect(rows.map((row) => row.number)).toEqual([1, 2]);
    expect((await app.list.execute(scope, card.id)).items).toEqual([]);
  });

  it('is ResourceNotFound for a cancelled purchase on get, edit and a second delete (sad path)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));
    app.clock.current = new Date('2026-11-25T12:00:00.000Z');
    await app.remove.execute(scope, card.id, created.id);

    await expect(app.get.execute(scope, card.id, created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      app.update.execute(scope, card.id, created.id, { note: 'x' }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(app.remove.execute(scope, card.id, created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('deletes the whole purchase when no statement has closed', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));

    await app.remove.execute(scope, card.id, created.id);

    expect(app.installments.purchases.size).toBe(0);
  });
});

describe('ownership', () => {
  it("answers ResourceNotFound to another user's get, edit and delete and changes nothing (AC-10)", async () => {
    const { app, card } = await withCard();
    const created = await app.create.execute(
      await writeScopeFor(ANA),
      card.id,
      purchase(12000000n, 12),
    );
    const bob = await writeScopeFor(BOB);

    await expect(app.get.execute(bob, card.id, created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      app.update.execute(bob, card.id, created.id, { note: 'hacked' }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(app.remove.execute(bob, card.id, created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    const stored = await app.get.execute(await writeScopeFor(ANA), card.id, created.id);
    expect(stored.note).toBeNull();
    expect(stored.installments).toHaveLength(12);
  });

  it('refuses a purchase id that belongs to another card of the same user', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const other = await app.createCard.execute(scope, { ...visa, name: 'Master' });
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));

    await expect(app.get.execute(scope, other.id, created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('UpdateInstallmentPurchase', () => {
  it('moves the monthly expense to the new category and keeps the amounts (FR-09)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));

    const updated = await app.update.execute(scope, card.id, created.id, {
      categoryId: HOME,
      note: 'Heladera',
    });

    expect(updated.categoryId).toBe(HOME);
    expect(updated.note).toBe('Heladera');
    expect(updated.installments.map((i) => i.amount)).toEqual(
      created.installments.map((i) => i.amount),
    );
    const month = await app.monthly.execute(await readScopeFor(ANA), {
      from: '2026-11',
      to: '2026-11',
    });
    expect(month).toEqual([{ month: '2026-11', categoryId: HOME, amount: 1000000n }]);
  });

  it('refuses a rejected new category and changes nothing (sad path)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    const created = await app.create.execute(scope, card.id, purchase(12000000n, 12));
    app.categories.rejected.set(HOME, new Error('MOVEMENT_CATEGORY_KIND_MISMATCH'));

    await expect(
      app.update.execute(scope, card.id, created.id, { categoryId: HOME }),
    ).rejects.toThrow('MOVEMENT_CATEGORY_KIND_MISMATCH');
    expect((await app.get.execute(scope, card.id, created.id)).categoryId).toBe(FOOD);
  });
});

describe('ListInstallmentExpenses', () => {
  it('counts only the installment of the month: 10,000.00 ARS in November 2026, not the rest (AC-06)', async () => {
    const { app, card } = await withCard();
    await app.create.execute(await writeScopeFor(ANA), card.id, purchase(12000000n, 12));
    const read = await readScopeFor(ANA);

    expect(await app.monthly.execute(read, { from: '2026-11', to: '2026-11' })).toEqual([
      { month: '2026-11', categoryId: FOOD, amount: 1000000n },
    ]);
    const year = await app.monthly.execute(read, { from: '2026-11', to: '2027-10' });
    expect(year).toHaveLength(12);
    expect(year.reduce((sum, item) => sum + item.amount, 0n)).toBe(12000000n);
    expect(await app.monthly.execute(read, { from: '2026-10', to: '2026-10' })).toEqual([]);
  });

  it('is empty for another user and for a month without installments (error path of empty data)', async () => {
    const { app, card } = await withCard();
    await app.create.execute(await writeScopeFor(ANA), card.id, purchase(12000000n, 12));

    expect(
      await app.monthly.execute(await readScopeFor(BOB), { from: '2026-11', to: '2027-10' }),
    ).toEqual([]);
    expect(
      await app.monthly.execute(await readScopeFor(ANA), { from: '2030-01', to: '2030-01' }),
    ).toEqual([]);
  });
});

describe('DeleteCreditCard with installment purchases', () => {
  it('refuses to delete a card that has purchases (sad path)', async () => {
    const { app, card } = await withCard();
    const scope = await writeScopeFor(ANA);
    await app.create.execute(scope, card.id, purchase(12000000n, 12));

    await expect(app.deleteCard.execute(scope, card.id)).rejects.toBeInstanceOf(CardHasMovements);
    expect(app.cards.cards.has(card.id)).toBe(true);
  });
});
