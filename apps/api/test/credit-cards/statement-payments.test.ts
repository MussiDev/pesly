import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { ListStatements } from '../../src/credit-cards/application/list-statements';
import { RecordStatementPayment } from '../../src/credit-cards/application/record-statement-payment';
import { UpdateStatementDates } from '../../src/credit-cards/application/update-statement-dates';
import type { CreditCard } from '../../src/credit-cards/domain/credit-card';
import {
  allocatePayments,
  paymentStatus,
  pesosForRate,
} from '../../src/credit-cards/domain/statement-payment';
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
const BANK = '7c1f6a40-0000-4000-8000-000000000001';
const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };

function setup(now = '2026-10-06T12:00:00.000Z') {
  const cards = new InMemoryCreditCards();
  const clock = new FakeClock(new Date(now));
  const expenses = new FakeExpenseRecorder(clock);
  const deps = {
    cards,
    activity: new FakeActivity(),
    timeZones: new FakeTimeZones(),
    clock,
    purchases: new FakeCardPurchases(expenses),
    expenses,
    ...installmentFakes(),
  };
  return {
    clock,
    expenses,
    recorder: deps.paymentRecorder,
    create: new CreateCreditCard(deps),
    statements: new ListStatements(deps),
    updateStatement: new UpdateStatementDates(deps),
    pay: new RecordStatementPayment(deps),
  };
}

async function spend(
  app: ReturnType<typeof setup>,
  card: CreditCard,
  amount: bigint,
  occurredAt: string,
  currency: 'ARS' | 'USD' = 'ARS',
) {
  await app.expenses.record(await writeScopeFor(ANA), {
    accountId: currency === 'ARS' ? card.arsAccountId : card.usdAccountId,
    categoryId: 'category',
    amount,
    occurredAt: new Date(occurredAt),
    rate: { source: 'automatic' },
  });
}

async function payment(app: ReturnType<typeof setup>, card: CreditCard, amount: bigint) {
  return app.pay.execute(await writeScopeFor(ANA), card.id, {
    currency: 'ARS',
    sourceAccountId: BANK,
    amount,
    occurredAt: new Date('2026-11-01T15:00:00.000Z'),
  });
}

/** A card with a 60,000.00 ARS purchase in the October statement, closed on 2026-11-10. */
async function closedOctober() {
  const app = setup();
  const card = await app.create.execute(await writeScopeFor(ANA), visa);
  await spend(app, card, 6_000_000n, '2026-10-05T15:00:00.000Z');
  app.clock.current = new Date('2026-11-10T15:00:00.000Z');
  return { app, card };
}

async function october(app: ReturnType<typeof setup>, card: CreditCard) {
  const views = await app.statements.execute(await writeScopeFor(ANA), card.id);
  const view = views.find((statement) => statement.period === '2026-10');
  if (!view) throw new Error('missing October statement');
  return view;
}

describe('paymentStatus', () => {
  it('is paid when payments cover the total, partial below it and unpaid with none (D3)', () => {
    expect(paymentStatus(6_000_000n, 6_000_000n)).toBe('paid');
    expect(paymentStatus(6_000_000n, 2_000_000n)).toBe('partially_paid');
    expect(paymentStatus(6_000_000n, 0n)).toBe('unpaid');
    expect(paymentStatus(0n, 0n)).toBe('paid');
  });
});

describe('allocatePayments', () => {
  const statements = [
    { id: 'old', totals: { ARS: 6_000_000n, USD: 0n } },
    { id: 'new', totals: { ARS: 3_000_000n, USD: 5_000n } },
  ];

  it('pays the oldest statement first and leaves the next partially paid (D1)', () => {
    const views = allocatePayments(statements, { ARS: 8_000_000n, USD: 0n });
    expect(views.get('old')?.ARS).toEqual({ paid: 6_000_000n, status: 'paid' });
    expect(views.get('new')?.ARS).toEqual({ paid: 2_000_000n, status: 'partially_paid' });
  });

  it('keeps a payment above every total as credit and allocates currencies apart (D1)', () => {
    const views = allocatePayments(statements, { ARS: 99_000_000n, USD: 1_000n });
    expect(views.get('new')?.ARS).toEqual({ paid: 3_000_000n, status: 'paid' });
    expect(views.get('new')?.USD).toEqual({ paid: 1_000n, status: 'partially_paid' });
    expect(views.get('old')?.USD.status).toBe('paid');
  });

  it('reads every statement unpaid when nothing was received (error path of empty data)', () => {
    const views = allocatePayments(statements, { ARS: 0n, USD: 0n });
    expect(views.get('old')?.ARS.status).toBe('unpaid');
    expect(views.get('new')?.ARS.status).toBe('unpaid');
  });
});

describe('statements with payments', () => {
  it('shows a statement of 60,000.00 ARS paid when 60,000.00 ARS were paid (AC-03)', async () => {
    const { app, card } = await closedOctober();
    await payment(app, card, 6_000_000n);
    expect((await october(app, card)).payments?.ARS).toEqual({
      paid: 6_000_000n,
      status: 'paid',
    });
  });

  it('shows it partially paid when 20,000.00 ARS were paid (AC-04)', async () => {
    const { app, card } = await closedOctober();
    await payment(app, card, 2_000_000n);
    expect((await october(app, card)).payments?.ARS).toEqual({
      paid: 2_000_000n,
      status: 'partially_paid',
    });
  });

  it('shows it unpaid with no payments, and an open statement has no payments (D3)', async () => {
    const { app, card } = await closedOctober();
    const views = await app.statements.execute(await writeScopeFor(ANA), card.id);
    expect(views.find((view) => view.period === '2026-10')?.payments?.ARS.status).toBe('unpaid');
    expect(views.find((view) => view.status === 'open')?.payments).toBeNull();
  });

  it('does not count the payment as part of the statement purchases (AC-01)', async () => {
    const { app, card } = await closedOctober();
    await payment(app, card, 6_000_000n);
    expect((await october(app, card)).totals.ARS).toBe(6_000_000n);
  });

  it('does not count payments of another user (sad path)', async () => {
    const { app, card } = await closedOctober();
    await app.recorder.record(await writeScopeFor(BOB), {
      sourceAccountId: BANK,
      destinationAccountId: card.arsAccountId,
      amount: 6_000_000n,
      occurredAt: new Date('2026-11-01T15:00:00.000Z'),
    });
    expect((await october(app, card)).payments?.ARS.status).toBe('unpaid');
  });

  it('keeps the status when the dates of an open statement change (update path)', async () => {
    const { app, card } = await closedOctober();
    await payment(app, card, 6_000_000n);
    const views = await app.statements.execute(await writeScopeFor(ANA), card.id);
    const open = views.find((view) => view.status === 'open');
    if (!open) throw new Error('missing open statement');
    const updated = await app.updateStatement.execute(await writeScopeFor(ANA), card.id, open.id, {
      dueDate: '2026-12-08',
    });
    expect(updated.payments).toBeNull();
  });
});

describe('pesosForRate', () => {
  it('multiplies exactly and removes the scale, rounding half-up', () => {
    expect(pesosForRate(5_959n, 15_350_000n)).toBe(9_147_065n);
    expect(pesosForRate(1n, 15_355_000n)).toBe(1_536n);
    expect(pesosForRate(1n, 15_354_999n)).toBe(1_535n);
    expect(pesosForRate(10n ** 15n, 100_000_000_000n)).toBe(10n ** 22n);
  });
});

describe('RecordStatementPayment with pesos', () => {
  const pay = async (app: ReturnType<typeof setup>, card: CreditCard, extra: object) =>
    app.pay.execute(await writeScopeFor(ANA), card.id, {
      currency: 'USD',
      sourceAccountId: BANK,
      amount: 5_959n,
      occurredAt: new Date('2026-11-01T15:00:00.000Z'),
      ...extra,
    });

  it('passes the pesos debited to the recorder as given', async () => {
    const { app, card } = await closedOctober();
    const recorded = await pay(app, card, { pesosAmount: 9_147_065n });
    expect(recorded.exchange?.pesosAmount).toBe(9_147_065n);
    expect(app.recorder.payments[0]).toMatchObject({
      destinationAccountId: card.usdAccountId,
      amount: 5_959n,
      pesosDebited: 9_147_065n,
    });
  });

  it('derives the pesos from the rate', async () => {
    const { app, card } = await closedOctober();
    await pay(app, card, { rate: 15_350_000n });
    expect(app.recorder.payments[0]?.pesosDebited).toBe(9_147_065n);
  });

  it('refuses pesos on an ARS payment and a rate whose pesos leave the range, recording nothing', async () => {
    const { app, card } = await closedOctober();
    await expect(
      app.pay.execute(await writeScopeFor(ANA), card.id, {
        currency: 'ARS',
        sourceAccountId: BANK,
        amount: 100n,
        pesosAmount: 100n,
        occurredAt: new Date('2026-11-01T15:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(pay(app, card, { amount: 1n, rate: 1n })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      pay(app, card, { amount: 10n ** 15n, rate: 100_000_000_000n }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(app.recorder.payments).toEqual([]);
  });
});

describe('RecordStatementPayment', () => {
  it('records a transfer to the ARS account of the card with the amount (AC-01)', async () => {
    const { app, card } = await closedOctober();
    const recorded = await payment(app, card, 6_000_000n);
    expect(recorded).toMatchObject({
      sourceAccountId: BANK,
      accountId: card.arsAccountId,
      currency: 'ARS',
      amount: 6_000_000n,
    });
    expect(app.recorder.payments).toEqual([
      expect.objectContaining({
        ownerId: ANA,
        sourceAccountId: BANK,
        destinationAccountId: card.arsAccountId,
        amount: 6_000_000n,
      }),
    ]);
  });

  it('targets the USD account for a USD payment and passes the note', async () => {
    const { app, card } = await closedOctober();
    await app.pay.execute(await writeScopeFor(ANA), card.id, {
      currency: 'USD',
      sourceAccountId: BANK,
      amount: 5_000n,
      occurredAt: new Date('2026-11-01T15:00:00.000Z'),
      note: 'Visa USD',
    });
    expect(app.recorder.payments[0]).toMatchObject({
      destinationAccountId: card.usdAccountId,
      note: 'Visa USD',
    });
  });

  it('propagates a currency mismatch from the transfer rules and stores nothing (AC-02)', async () => {
    const { app, card } = await closedOctober();
    app.recorder.failWith = new Error('MOVEMENT_CURRENCY_MISMATCH');
    await expect(payment(app, card, 6_000_000n)).rejects.toThrow('MOVEMENT_CURRENCY_MISMATCH');
    expect(app.recorder.payments).toEqual([]);
    expect((await october(app, card)).payments?.ARS.status).toBe('unpaid');
  });

  it("answers 404 for another user's card and records nothing (sad path)", async () => {
    const { app, card } = await closedOctober();
    await expect(
      app.pay.execute(await writeScopeFor(BOB), card.id, {
        currency: 'ARS',
        sourceAccountId: BANK,
        amount: 1n,
        occurredAt: new Date('2026-11-01T15:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(app.recorder.payments).toEqual([]);
  });
});
