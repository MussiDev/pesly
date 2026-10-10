import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { ListStatements } from '../../src/credit-cards/application/list-statements';
import { RecordCardExpense } from '../../src/credit-cards/application/record-card-expense';
import { UpdateStatementDates } from '../../src/credit-cards/application/update-statement-dates';
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
const CATEGORY = '7c1d6c6e-7f0e-4d57-9a53-6a1b5d7d1a11';

function setup(now = '2026-10-06T12:00:00.000Z') {
  const cards = new InMemoryCreditCards();
  const clock = new FakeClock(new Date(now));
  const recorder = new FakeExpenseRecorder(clock);
  const deps = {
    cards,
    activity: new FakeActivity(),
    timeZones: new FakeTimeZones(),
    clock,
    purchases: new FakeCardPurchases(recorder),
    expenses: recorder,
    ...installmentFakes(),
  };
  return {
    cards,
    clock,
    recorder,
    create: new CreateCreditCard(deps),
    statements: new ListStatements(deps),
    updateStatement: new UpdateStatementDates(deps),
    recordExpense: new RecordCardExpense(deps),
  };
}

const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };
const rate = { source: 'automatic' } as const;

function expense(currency: 'ARS' | 'USD', amount: bigint, occurredAt: string) {
  return { currency, categoryId: CATEGORY, amount, occurredAt: new Date(occurredAt), rate };
}

describe('RecordCardExpense', () => {
  it('records USD on the card USD account and ARS on its ARS account (AC-01)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);

    const usd = await app.recordExpense.execute(
      scope,
      card.id,
      expense('USD', 1599n, '2026-10-06T10:00:00.000Z'),
    );
    const ars = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 2500000n, '2026-10-06T10:00:00.000Z'),
    );

    expect(usd).toMatchObject({ accountId: card.usdAccountId, currency: 'USD', amount: 1599n });
    expect(ars).toMatchObject({ accountId: card.arsAccountId, currency: 'ARS', amount: 2500000n });
    expect(app.recorder.expenses.map((e) => [e.accountId, e.amount])).toEqual([
      [card.usdAccountId, 1599n],
      [card.arsAccountId, 2500000n],
    ]);
  });

  it('passes the category, note and rate to the recorder (AC-01)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);
    const manual = { source: 'manual', value: 12_000_000n } as const;

    const result = await app.recordExpense.execute(scope, card.id, {
      ...expense('USD', 1599n, '2026-10-06T10:00:00.000Z'),
      note: 'Coffee',
      rate: manual,
    });

    expect(app.recorder.expenses).toEqual([
      expect.objectContaining({
        id: result.movementId,
        categoryId: CATEGORY,
        note: 'Coffee',
        rate: manual,
      }),
    ]);
  });

  it('assigns a purchase of the closing day to that statement and the next day to the next (AC-02, AC-03)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);
    const [october] = await app.statements.execute(scope, card.id);
    app.clock.current = new Date('2026-10-25T15:00:00.000Z');

    // 2026-10-25T02:00Z is still 2026-10-24 in Buenos Aires.
    const onClosing = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 100n, '2026-10-25T02:00:00.000Z'),
    );
    const nextDay = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 100n, '2026-10-25T03:00:00.000Z'),
    );
    const earlier = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 100n, '2026-09-01T12:00:00.000Z'),
    );

    const stored = await app.statements.execute(scope, card.id);
    const november = stored.find((s) => s.period === '2026-11');
    expect(onClosing.statementId).toBe(october?.id);
    expect(nextDay.statementId).toBe(november?.id);
    expect(earlier.statementId).toBe(october?.id);
  });

  it('moves purchases between statements when the closing date moves (AC-04)', async () => {
    const app = setup('2026-10-23T12:00:00.000Z');
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);
    const [october] = await app.statements.execute(scope, card.id);
    if (!october) throw new Error('no statement');
    await app.updateStatement.execute(scope, card.id, october.id, { closingDate: '2026-10-26' });
    app.clock.current = new Date('2026-10-27T12:00:00.000Z');

    const on25 = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 100n, '2026-10-25T15:00:00.000Z'),
    );
    const on26 = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 200n, '2026-10-26T15:00:00.000Z'),
    );
    const on27 = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 400n, '2026-10-27T11:00:00.000Z'),
    );

    expect(on25.statementId).toBe(october.id);
    expect(on26.statementId).toBe(october.id);
    expect(on27.statementId).not.toBe(october.id);
    const stored = await app.statements.execute(scope, card.id);
    expect(stored.find((s) => s.id === october.id)?.totals).toEqual({ ARS: 300n, USD: 0n });
    expect(stored.find((s) => s.id === on27.statementId)?.totals).toEqual({ ARS: 400n, USD: 0n });
  });

  it('totals 50,000.00 ARS in two purchases and 20.00 USD, and zeros without purchases (AC-05)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);
    await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 3000000n, '2026-10-02T15:00:00.000Z'),
    );
    await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 2000000n, '2026-10-03T15:00:00.000Z'),
    );
    await app.recordExpense.execute(
      scope,
      card.id,
      expense('USD', 2000n, '2026-10-04T15:00:00.000Z'),
    );
    app.clock.current = new Date('2026-11-10T12:00:00.000Z');

    const stored = await app.statements.execute(scope, card.id);

    expect(stored.map((s) => [s.period, s.totals])).toEqual([
      ['2026-11', { ARS: 0n, USD: 0n }],
      ['2026-10', { ARS: 5000000n, USD: 2000n }],
    ]);
  });

  it('answers ResourceNotFound for a card of another user and records nothing (sad path)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);

    await expect(
      app.recordExpense.execute(
        await writeScopeFor(BOB),
        card.id,
        expense('USD', 1599n, '2026-10-06T10:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(app.recorder.expenses).toHaveLength(0);
  });

  it('propagates a recorder failure for a future date and stores no expense (sad path)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);

    await expect(
      app.recordExpense.execute(scope, card.id, expense('USD', 1599n, '2026-10-07T12:00:00.000Z')),
    ).rejects.toThrow('MOVEMENT_DATE_IN_FUTURE');
    expect(app.recorder.expenses).toHaveLength(0);
  });

  it('creates the missing cycles up to today before recording (FR-02)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await app.create.execute(scope, visa);
    app.clock.current = new Date('2027-01-10T12:00:00.000Z');

    const result = await app.recordExpense.execute(
      scope,
      card.id,
      expense('ARS', 100n, '2027-01-09T12:00:00.000Z'),
    );

    expect(result.statementId).not.toBeNull();
    expect([...app.cards.statements.values()].map((s) => s.period).sort()).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });
});
