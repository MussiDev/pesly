import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { DeleteCreditCard } from '../../src/credit-cards/application/delete-credit-card';
import { GetCreditCard } from '../../src/credit-cards/application/get-credit-card';
import { ListCreditCards } from '../../src/credit-cards/application/list-credit-cards';
import { ListStatements } from '../../src/credit-cards/application/list-statements';
import { UpdateCreditCardDays } from '../../src/credit-cards/application/update-credit-card-days';
import { UpdateStatementDates } from '../../src/credit-cards/application/update-statement-dates';
import {
  CardAccountNameTaken,
  CardDaysConflict,
  CardHasMovements,
  StatementClosed,
  StatementDatesInvalid,
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

function setup(now = '2026-10-06T12:00:00.000Z') {
  const cards = new InMemoryCreditCards();
  const activity = new FakeActivity();
  const timeZones = new FakeTimeZones();
  const clock = new FakeClock(new Date(now));
  const expenses = new FakeExpenseRecorder(clock);
  const purchases = new FakeCardPurchases(expenses);
  const deps = { cards, activity, timeZones, clock, purchases, expenses, ...installmentFakes() };
  return {
    cards,
    expenses,
    activity,
    clock,
    create: new CreateCreditCard(deps),
    list: new ListCreditCards(deps),
    get: new GetCreditCard(deps),
    updateDays: new UpdateCreditCardDays(deps),
    remove: new DeleteCreditCard(deps),
    statements: new ListStatements(deps),
    updateStatement: new UpdateStatementDates(deps),
  };
}

const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };

describe('CreateCreditCard', () => {
  it('creates the card, both linked accounts and the open October statement (AC-01, AC-03, AC-04)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);

    expect(card).toMatchObject(visa);
    expect([...(app.cards.accountNames.get(ANA) ?? [])]).toEqual(['visa ars', 'visa usd']);
    const statements = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(statements).toEqual([
      expect.objectContaining({
        period: '2026-10',
        closingDate: '2026-10-24',
        dueDate: '2026-11-05',
        status: 'open',
        totals: { ARS: 0n, USD: 0n },
      }),
    ]);
  });

  it('starts with the next cycle when the closing day already passed (FR-03)', async () => {
    const app = setup('2026-10-25T15:00:00.000Z');
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    const [first] = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(first?.period).toBe('2026-11');
  });

  it('refuses a card whose account names are taken (sad path, D3)', async () => {
    const app = setup();
    await app.create.execute(await writeScopeFor(ANA), visa);
    await expect(app.create.execute(await writeScopeFor(ANA), visa)).rejects.toBeInstanceOf(
      CardAccountNameTaken,
    );
  });
});

describe('ListCreditCards and GetCreditCard', () => {
  it("lists only the caller's cards and hides another user's card behind 404 (AC-10, AC-11)", async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    await app.create.execute(await writeScopeFor(BOB), { ...visa, name: 'Master' });

    expect((await app.list.execute(await readScopeFor(ANA))).map((c) => c.name)).toEqual(['Visa']);
    expect((await app.get.execute(await readScopeFor(ANA), card.id)).id).toBe(card.id);
    await expect(app.get.execute(await readScopeFor(BOB), card.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('ListStatements', () => {
  it('creates the missing cycles and marks the past ones closed (AC-09, FR-03)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    app.clock.current = new Date('2027-01-10T12:00:00.000Z');

    const statements = await app.statements.execute(await writeScopeFor(ANA), card.id);

    expect(statements.map((s) => [s.period, s.status])).toEqual([
      ['2027-01', 'open'],
      ['2026-12', 'closed'],
      ['2026-11', 'closed'],
      ['2026-10', 'closed'],
    ]);
  });

  it('closes a statement once its closing date has ended in the user time zone (AC-09, FR-07)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);

    // 2026-10-24 23:00 in Buenos Aires (UTC-3).
    app.clock.current = new Date('2026-10-25T02:00:00.000Z');
    const before = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(before.find((s) => s.period === '2026-10')?.status).toBe('open');

    // 2026-10-25 00:00 in Buenos Aires.
    app.clock.current = new Date('2026-10-25T03:00:00.000Z');
    const after = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(after.find((s) => s.period === '2026-10')?.status).toBe('closed');
  });

  it("answers 404 for another user's card (sad path, AC-10)", async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    await expect(app.statements.execute(await writeScopeFor(BOB), card.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('UpdateStatementDates', () => {
  async function withCard(now?: string) {
    const app = setup(now);
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    const [october] = await app.statements.execute(await writeScopeFor(ANA), card.id);
    if (!october) throw new Error('no statement');
    return { app, card, october };
  }

  it('moves an open statement closing date from the 24th to the 26th (AC-06)', async () => {
    const { app, card, october } = await withCard();
    const updated = await app.updateStatement.execute(
      await writeScopeFor(ANA),
      card.id,
      october.id,
      {
        closingDate: '2026-10-26',
      },
    );
    expect(updated).toMatchObject({
      closingDate: '2026-10-26',
      dueDate: '2026-11-05',
      status: 'open',
      totals: { ARS: 0n, USD: 0n },
    });
  });

  it('answers the totals of the purchases assigned after the move (AC-04, AC-05)', async () => {
    const { app, card, october } = await withCard('2026-10-25T15:00:00.000Z');
    // The 24th has passed: record through the fake, then read the totals of the stored cycles.
    app.expenses.expenses.push({
      ownerId: ANA,
      id: 'e1',
      accountId: card.arsAccountId,
      categoryId: 'c',
      amount: 700n,
      occurredAt: new Date('2026-10-25T15:00:00.000Z'),
      rate: { source: 'automatic' },
    });
    const november = (await app.statements.execute(await writeScopeFor(ANA), card.id)).find(
      (s) => s.period === '2026-11',
    );
    if (!november) throw new Error('no november');

    const updated = await app.updateStatement.execute(
      await writeScopeFor(ANA),
      card.id,
      november.id,
      { dueDate: '2026-12-07' },
    );

    expect(october.totals).toEqual({ ARS: 0n, USD: 0n });
    expect(updated.totals).toEqual({ ARS: 700n, USD: 0n });
  });

  it('refuses to change a closed statement (sad path, AC-07)', async () => {
    const { app, card, october } = await withCard();
    app.clock.current = new Date('2026-11-01T12:00:00.000Z');
    await expect(
      app.updateStatement.execute(await writeScopeFor(ANA), card.id, october.id, {
        closingDate: '2026-10-26',
      }),
    ).rejects.toBeInstanceOf(StatementClosed);
  });

  it('refuses dates that break the order of statements (sad path, D9)', async () => {
    const { app, card, october } = await withCard();
    await expect(
      app.updateStatement.execute(await writeScopeFor(ANA), card.id, october.id, {
        closingDate: '2026-11-24',
      }),
    ).rejects.toBeInstanceOf(StatementDatesInvalid);
    await expect(
      app.updateStatement.execute(await writeScopeFor(ANA), card.id, october.id, {
        dueDate: '2026-10-20',
      }),
    ).rejects.toBeInstanceOf(StatementDatesInvalid);
  });

  it('refuses an edit after the previous statement closed late (sad path, D9)', async () => {
    const { app, card } = await withCard();
    app.clock.current = new Date('2026-10-30T12:00:00.000Z');
    const statements = await app.statements.execute(await writeScopeFor(ANA), card.id);
    const november = statements.find((s) => s.period === '2026-11');
    if (!november) throw new Error('no november');
    await expect(
      app.updateStatement.execute(await writeScopeFor(ANA), card.id, november.id, {
        closingDate: '2026-10-24',
      }),
    ).rejects.toBeInstanceOf(StatementDatesInvalid);
  });

  it("answers 404 for another user's statement or a statement of another card (sad path, AC-10)", async () => {
    const { app, card, october } = await withCard();
    const other = await app.create.execute(await writeScopeFor(ANA), { ...visa, name: 'Amex' });
    await expect(
      app.updateStatement.execute(await writeScopeFor(BOB), card.id, october.id, {
        closingDate: '2026-10-26',
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      app.updateStatement.execute(await writeScopeFor(ANA), other.id, october.id, {
        closingDate: '2026-10-26',
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('UpdateCreditCardDays', () => {
  it('rewrites open statements, hand edits included, and leaves closed ones unchanged (AC-08)', async () => {
    const app = setup('2026-09-30T12:00:00.000Z');
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    const [october] = await app.statements.execute(await writeScopeFor(ANA), card.id);
    if (!october) throw new Error('no statement');
    await app.updateStatement.execute(await writeScopeFor(ANA), card.id, october.id, {
      closingDate: '2026-10-26',
    });
    app.clock.current = new Date('2026-10-28T12:00:00.000Z');
    const generated = await app.statements.execute(await writeScopeFor(ANA), card.id);
    const november = generated.find((s) => s.period === '2026-11');
    if (!november) throw new Error('no november');
    await app.updateStatement.execute(await writeScopeFor(ANA), card.id, november.id, {
      closingDate: '2026-11-25',
    });

    const updated = await app.updateDays.execute(await writeScopeFor(ANA), card.id, {
      closingDay: 20,
    });

    expect(updated.closingDay).toBe(20);
    const statements = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(statements.map((s) => [s.period, s.closingDate])).toEqual([
      ['2026-11', '2026-11-20'],
      ['2026-10', '2026-10-26'],
    ]);
  });

  it('refuses days that would close the open statement on or before the previous one (sad path)', async () => {
    const app = setup('2026-10-06T12:00:00.000Z');
    const card = await app.create.execute(await writeScopeFor(ANA), { ...visa, closingDay: 31 });
    const [october] = await app.statements.execute(await writeScopeFor(ANA), card.id);
    if (!october) throw new Error('no statement');
    await app.updateStatement.execute(await writeScopeFor(ANA), card.id, october.id, {
      closingDate: '2026-11-03',
      dueDate: '2026-11-15',
    });
    app.clock.current = new Date('2026-11-04T12:00:00.000Z');
    await app.statements.execute(await writeScopeFor(ANA), card.id);

    await expect(
      app.updateDays.execute(await writeScopeFor(ANA), card.id, { closingDay: 2 }),
    ).rejects.toBeInstanceOf(CardDaysConflict);
  });

  it("answers 404 for another user's card (sad path, AC-10)", async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    await expect(
      app.updateDays.execute(await writeScopeFor(BOB), card.id, { dueDay: 7 }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('DeleteCreditCard', () => {
  it('deletes the card with its statements and both accounts (FR-08, D1)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    await app.remove.execute(await writeScopeFor(ANA), card.id);
    expect(app.cards.cards.size).toBe(0);
    expect(app.cards.statements.size).toBe(0);
    expect(app.cards.deletedAccounts).toEqual([card.arsAccountId, card.usdAccountId]);
  });

  it('refuses when a linked account has movements and deletes nothing (sad path, D1)', async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    app.activity.withMovements.add(card.usdAccountId);
    await expect(app.remove.execute(await writeScopeFor(ANA), card.id)).rejects.toBeInstanceOf(
      CardHasMovements,
    );
    expect(app.cards.cards.size).toBe(1);
  });

  it("answers 404 for another user's card and changes nothing (sad path, AC-10)", async () => {
    const app = setup();
    const card = await app.create.execute(await writeScopeFor(ANA), visa);
    await expect(app.remove.execute(await writeScopeFor(BOB), card.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(app.cards.cards.size).toBe(1);
  });
});
