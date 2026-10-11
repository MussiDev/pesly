import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { ensureStatements } from '../../src/credit-cards/application/ensure-statements';
import {
  CreateStatementReminders,
  type ReminderFailure,
  type ReminderSummary,
} from '../../src/credit-cards/application/create-statement-reminders';
import type {
  CreditCard,
  Statement,
  StatementView,
} from '../../src/credit-cards/domain/credit-card';
import {
  STATEMENT_REMINDER_TIME,
  owesStatement,
  reminderCandidates,
  reminderKey,
} from '../../src/credit-cards/domain/statement-reminder';
import {
  FakeActivity,
  FakeCardPurchases,
  FakeClock,
  FakeExpenseRecorder,
  FakeStatementReminderPublisher,
  FakeStatementReminderSource,
  FakeTimeZones,
  InMemoryCreditCards,
  installmentFakes,
  writeScopeFor,
} from './fakes';

const ANA = 'ana';
const BOB = 'bob';
const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };
/** Statement 2026-10 closes on 2026-10-24 and is due on 2026-11-05; 3 days before is 2026-11-02. */
const DUE_DAY = '2026-11-05';
/** Buenos Aires is UTC-3, so 09:00 local is 12:00Z. */
const NOV_01_0900 = '2026-11-01T12:00:00.000Z';
const NOV_02_0859 = '2026-11-02T11:59:00.000Z';
const NOV_02_0900 = '2026-11-02T12:00:00.000Z';
const NOV_02_0910 = '2026-11-02T12:10:00.000Z';

function setup(zone = 'America/Argentina/Buenos_Aires', pageSize?: number) {
  const cards = new InMemoryCreditCards();
  const clock = new FakeClock(new Date('2026-10-06T12:00:00.000Z'));
  const timeZones = new FakeTimeZones();
  timeZones.zone = zone;
  const expenses = new FakeExpenseRecorder(clock);
  const fakes = installmentFakes();
  const deps = {
    cards,
    activity: new FakeActivity(),
    timeZones,
    clock,
    purchases: new FakeCardPurchases(expenses),
    expenses,
    ...fakes,
  };
  const publisher = new FakeStatementReminderPublisher();
  const source = new FakeStatementReminderSource(cards, timeZones);
  const failures: ReminderFailure[] = [];
  const job = new CreateStatementReminders({
    cards,
    purchases: deps.purchases,
    installments: fakes.installments,
    cardPayments: fakes.cardPayments,
    clock,
    source,
    publisher,
    scopeFor: writeScopeFor,
    report: (failure) => failures.push(failure),
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  return {
    cards,
    clock,
    expenses,
    publisher,
    source,
    transfers: fakes.paymentRecorder,
    failures,
    job,
    create: new CreateCreditCard(deps),
  };
}

type App = ReturnType<typeof setup>;

/** A card with its spending in October (closing 2026-10-24); no spending when `ars` is 0n. */
async function cardWith(
  app: App,
  options: {
    owner?: string;
    name?: string;
    ars?: bigint;
    usd?: bigint;
    reminderDays?: number;
  } = {},
): Promise<CreditCard> {
  const scope = await writeScopeFor(options.owner ?? ANA);
  const card = await app.create.execute(scope, {
    ...visa,
    name: options.name ?? visa.name,
    ...(options.reminderDays === undefined ? {} : { reminderDays: options.reminderDays }),
  });
  const spend = async (accountId: string, amount: bigint) => {
    await app.expenses.record(scope, {
      accountId,
      categoryId: 'category',
      amount,
      occurredAt: new Date('2026-10-05T15:00:00.000Z'),
      rate: { source: 'automatic' },
    });
  };
  const ars = options.ars ?? 4_000_000n;
  if (ars > 0n) await spend(card.arsAccountId, ars);
  if (options.usd) await spend(card.usdAccountId, options.usd);
  return card;
}

async function runAt(app: App, instant: string): Promise<ReminderSummary> {
  app.clock.current = new Date(instant);
  return app.job.execute();
}

const createdFor = (app: App, statementDue: string) =>
  [...app.publisher.created.values()].filter((input) => input.dueDate === statementDue);

describe('statement reminder domain', () => {
  const statement = (period: string, dueDate: string): Statement => ({
    id: period,
    cardId: 'card',
    period,
    closingDate: '2026-01-01',
    dueDate,
  });
  const view = (
    totals: { ARS: bigint; USD: bigint },
    payments: { ARS: bigint; USD: bigint } | null,
  ): StatementView => ({
    ...statement('2026-10', DUE_DAY),
    status: payments ? 'closed' : 'open',
    totals,
    installments: [],
    payments: payments
      ? {
          ARS: { paid: payments.ARS, status: 'unpaid' },
          USD: { paid: payments.USD, status: 'unpaid' },
        }
      : null,
  });

  it('starts reminding at 09:00 local', () => {
    expect(STATEMENT_REMINDER_TIME).toBe('09:00');
  });

  it('includes the due date itself and drops a passed one (D6)', () => {
    const statements = [statement('2026-10', '2026-11-05')];
    const input = { statements, reminderDays: 3, reminderToday: '2026-11-05' };
    expect(reminderCandidates({ ...input, today: '2026-11-05' })).toHaveLength(1);
    expect(
      reminderCandidates({ ...input, today: '2026-11-06', reminderToday: '2026-11-06' }),
    ).toEqual([]);
  });

  it('excludes a statement before its reminder day and includes it on that day (D6)', () => {
    const statements = [statement('2026-10', '2026-11-05')];
    const input = { statements, reminderDays: 3, today: '2026-11-01' };
    expect(reminderCandidates({ ...input, reminderToday: '2026-11-01' })).toEqual([]);
    expect(reminderCandidates({ ...input, reminderToday: '2026-11-02' })).toHaveLength(1);
  });

  it('orders candidates by due date, oldest first', () => {
    const statements = [statement('2026-11', '2026-12-01'), statement('2026-10', '2026-11-05')];
    const candidates = reminderCandidates({
      statements,
      reminderDays: 30,
      today: '2026-11-01',
      reminderToday: '2026-11-01',
    });
    expect(candidates.map((s) => s.period)).toEqual(['2026-10', '2026-11']);
  });

  it('owes when any currency has total minus paid above zero (D8)', () => {
    expect(owesStatement(view({ ARS: 100n, USD: 0n }, { ARS: 40n, USD: 0n }))).toBe(true);
    expect(owesStatement(view({ ARS: 100n, USD: 5n }, { ARS: 100n, USD: 0n }))).toBe(true);
    expect(owesStatement(view({ ARS: 100n, USD: 5n }, { ARS: 100n, USD: 5n }))).toBe(false);
    expect(owesStatement(view({ ARS: 0n, USD: 0n }, { ARS: 0n, USD: 0n }))).toBe(false);
  });

  it('treats an open statement (no payments) as owing its whole total (D7)', () => {
    expect(owesStatement(view({ ARS: 100n, USD: 0n }, null))).toBe(true);
    expect(owesStatement(view({ ARS: 0n, USD: 0n }, null))).toBe(false);
  });

  it('keys a reminder by statement id and due date', () => {
    expect(reminderKey('s1', DUE_DAY)).toBe(reminderKey('s1', DUE_DAY));
    expect(reminderKey('s1', DUE_DAY)).not.toBe(reminderKey('s1', '2026-11-10'));
    expect(reminderKey('s1', DUE_DAY)).not.toBe(reminderKey('s2', DUE_DAY));
  });
});

describe('CreateStatementReminders', () => {
  it('creates the reminder at 2026-11-02 09:00 local and not on 2026-11-01 (AC-01)', async () => {
    const app = setup();
    const card = await cardWith(app);
    const early = await runAt(app, NOV_01_0900);
    expect(early.reminders).toBe(0);
    expect(app.publisher.created.size).toBe(0);
    const summary = await runAt(app, NOV_02_0900);
    expect(summary).toMatchObject({ cards: 1, reminders: 1, failed: 0 });
    const [input] = [...app.publisher.created.values()];
    expect(input).toMatchObject({
      ownerId: ANA,
      cardName: 'Visa',
      dueDate: DUE_DAY,
      language: 'es',
    });
    const statements = await ensureStatements(
      app.cards,
      await writeScopeFor(ANA),
      card,
      '2026-11-02',
    );
    expect(input?.statementId).toBe(statements.find((s) => s.period === '2026-10')?.id);
  });

  it('passes the owner language through to the publisher', async () => {
    const app = setup();
    await cardWith(app);
    app.source.languages.set(ANA, 'en');
    await runAt(app, NOV_02_0900);
    expect([...app.publisher.created.values()][0]?.language).toBe('en');
  });

  it('creates nothing at 08:59 local of the reminder day, creates at 09:00 and has by 09:10 (NFR-01)', async () => {
    const app = setup();
    await cardWith(app);
    await runAt(app, NOV_02_0859);
    expect(app.publisher.created.size).toBe(0);
    await runAt(app, NOV_02_0900);
    expect(app.publisher.created.size).toBe(1);

    const other = setup();
    await cardWith(other);
    await runAt(other, NOV_02_0910);
    expect(other.publisher.created.size).toBe(1);
  });

  it('takes the 09:00 from the owner zone, not the process zone (NFR-01)', async () => {
    const tokyo = setup('Asia/Tokyo');
    await cardWith(tokyo);
    // 08:59 and 09:00 on 2026-11-02 in Tokyo (UTC+9).
    await runAt(tokyo, '2026-11-01T23:59:00.000Z');
    expect(tokyo.publisher.created.size).toBe(0);
    await runAt(tokyo, '2026-11-02T00:00:00.000Z');
    expect(tokyo.publisher.created.size).toBe(1);

    const buenosAires = setup('America/Argentina/Buenos_Aires');
    await cardWith(buenosAires);
    await runAt(buenosAires, '2026-11-02T00:00:00.000Z');
    expect(buenosAires.publisher.created.size).toBe(0);
  });

  it('creates the reminder once on a first pass days after the reminder day (AC-07)', async () => {
    const app = setup();
    await cardWith(app);
    const summary = await runAt(app, '2026-11-04T15:00:00.000Z');
    expect(summary.reminders).toBe(1);
    expect(app.publisher.created.size).toBe(1);
  });

  it('creates on the due date at 09:00 and none the day after it (AC-07)', async () => {
    const onDay = setup();
    await cardWith(onDay);
    await runAt(onDay, '2026-11-05T12:00:00.000Z');
    expect(onDay.publisher.created.size).toBe(1);

    const after = setup();
    await cardWith(after);
    await runAt(after, '2026-11-06T12:00:00.000Z');
    expect(after.publisher.created.size).toBe(0);
  });

  it('reminds at 09:00 of the due date with 0 days and 30 days before with 30 (FR-01)', async () => {
    const zero = setup();
    await cardWith(zero, { reminderDays: 0 });
    await runAt(zero, '2026-11-04T15:00:00.000Z');
    expect(zero.publisher.created.size).toBe(0);
    await runAt(zero, '2026-11-05T11:59:00.000Z');
    expect(zero.publisher.created.size).toBe(0);
    await runAt(zero, '2026-11-05T12:00:00.000Z');
    expect(zero.publisher.created.size).toBe(1);

    const thirty = setup();
    await cardWith(thirty, { reminderDays: 30 });
    // 2026-10-05 is 31 days before the due date; 2026-10-06 is 30.
    await runAt(thirty, '2026-10-05T12:00:00.000Z');
    expect(thirty.publisher.created.size).toBe(0);
    await runAt(thirty, '2026-10-06T12:00:00.000Z');
    expect(thirty.publisher.created.size).toBe(1);
  });

  it('creates none when payments cover the total in ARS and USD (AC-04)', async () => {
    const app = setup();
    const card = await cardWith(app, { usd: 5_000n });
    const paid = (accountId: string, amount: bigint, id: string) =>
      app.transfers.payments.push({
        ownerId: ANA,
        id,
        sourceAccountId: 'bank',
        destinationAccountId: accountId,
        amount,
        occurredAt: new Date('2026-10-30T15:00:00.000Z'),
      });
    paid(card.arsAccountId, 4_000_000n, 'ars');
    paid(card.usdAccountId, 5_000n, 'usd');
    const summary = await runAt(app, NOV_02_0900);
    expect(app.publisher.created.size).toBe(0);
    expect(summary).toMatchObject({ reminders: 0, notOwed: 1 });
  });

  it('creates none for a total of 0 and one for a statement paid in ARS but owing USD (FR-03)', async () => {
    const empty = setup();
    await cardWith(empty, { ars: 0n });
    const summary = await runAt(empty, NOV_02_0900);
    expect(empty.publisher.created.size).toBe(0);
    expect(summary.notOwed).toBe(1);

    const app = setup();
    const card = await cardWith(app, { usd: 5_000n });
    app.transfers.payments.push({
      ownerId: ANA,
      id: 'ars',
      sourceAccountId: 'bank',
      destinationAccountId: card.arsAccountId,
      amount: 4_000_000n,
      occurredAt: new Date('2026-10-30T15:00:00.000Z'),
    });
    await runAt(app, NOV_02_0900);
    expect(app.publisher.created.size).toBe(1);
  });

  it('reminds an open statement with a total and not one without it (FR-01)', async () => {
    // 2026-10-06 09:00 local with 30 days: the 2026-10 statement is still open (closes 10-24).
    const withTotal = setup();
    await cardWith(withTotal, { reminderDays: 30 });
    await runAt(withTotal, '2026-10-06T12:00:00.000Z');
    expect(withTotal.publisher.created.size).toBe(1);

    const withoutTotal = setup();
    await cardWith(withoutTotal, { reminderDays: 30, ars: 0n });
    await runAt(withoutTotal, '2026-10-06T12:00:00.000Z');
    expect(withoutTotal.publisher.created.size).toBe(0);
  });

  it('creates 1 reminder over two sequential passes and reports alreadyPublished (AC-06)', async () => {
    const app = setup();
    await cardWith(app);
    const first = await runAt(app, NOV_02_0900);
    const second = await runAt(app, NOV_02_0910);
    expect(app.publisher.created.size).toBe(1);
    expect(first).toMatchObject({ reminders: 1, alreadyPublished: 0 });
    expect(second).toMatchObject({ reminders: 0, alreadyPublished: 1 });
    expect(app.publisher.publishCalls).toBe(1);
  });

  it('creates the reminder of a due date moved from 11-05 to 11-10 on 11-07 and none on 11-02 (AC-05)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await cardWith(app);
    const statements = await ensureStatements(app.cards, scope, card, '2026-10-06');
    const october = statements.find((s) => s.period === '2026-10');
    if (!october) throw new Error('missing October statement');
    await app.cards.updateStatement(scope, card.id, october.id, {
      closingDate: october.closingDate,
      dueDate: '2026-11-10',
    });
    await runAt(app, NOV_02_0900);
    expect(app.publisher.created.size).toBe(0);
    await runAt(app, '2026-11-07T12:00:00.000Z');
    expect(createdFor(app, '2026-11-10')).toHaveLength(1);
  });

  it('creates a second reminder for a due date moved after the first and keeps the first (AC-05)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await cardWith(app);
    await runAt(app, NOV_02_0900);
    expect(createdFor(app, DUE_DAY)).toHaveLength(1);
    const statements = await ensureStatements(app.cards, scope, card, '2026-11-02');
    const october = statements.find((s) => s.period === '2026-10');
    if (!october) throw new Error('missing October statement');
    await app.cards.updateStatement(scope, card.id, october.id, {
      closingDate: october.closingDate,
      dueDate: '2026-11-10',
    });
    await runAt(app, '2026-11-07T12:00:00.000Z');
    expect(createdFor(app, DUE_DAY)).toHaveLength(1);
    expect(createdFor(app, '2026-11-10')).toHaveLength(1);
    expect(app.publisher.created.size).toBe(2);
  });

  it('creates nothing for a deleted card (AC-09)', async () => {
    const app = setup();
    const card = await cardWith(app);
    await app.cards.delete(await writeScopeFor(ANA), card);
    const summary = await runAt(app, NOV_02_0900);
    expect(summary.cards).toBe(0);
    expect(app.publisher.created.size).toBe(0);
  });

  it('pages through the source and processes every card', async () => {
    const app = setup('America/Argentina/Buenos_Aires', 1);
    await cardWith(app, { name: 'Visa' });
    await cardWith(app, { name: 'Master' });
    await cardWith(app, { name: 'Amex' });
    const summary = await runAt(app, NOV_02_0900);
    expect(summary).toMatchObject({ cards: 3, reminders: 3 });
  });

  it('reports an error in one card with ids and class name only and processes the next card (NFR-02)', async () => {
    const app = setup();
    const broken = await cardWith(app, { owner: BOB, name: 'Broken' });
    const healthy = await cardWith(app, { owner: ANA, name: 'Healthy' });
    app.publisher.failingOwners.add(BOB);
    const summary = await runAt(app, NOV_02_0900);
    expect(summary).toMatchObject({ cards: 2, failed: 1, reminders: 1 });
    expect(app.failures).toEqual([{ cardId: broken.id, errorName: 'Error' }]);
    expect([...app.publisher.created.values()].map((input) => input.ownerId)).toEqual([ANA]);
    expect(healthy.id).not.toBe(broken.id);
  });

  it('retries the failed card on the next pass', async () => {
    const app = setup();
    await cardWith(app, { owner: BOB });
    app.publisher.failingOwners.add(BOB);
    await runAt(app, NOV_02_0900);
    app.publisher.failingOwners.clear();
    const second = await runAt(app, NOV_02_0910);
    expect(second.reminders).toBe(1);
  });

  it('reports failures without card name, amount, language or zone (AC-08)', async () => {
    const app = setup();
    await cardWith(app, { owner: BOB, name: 'Secret Visa', ars: 4_000_000n });
    app.source.languages.set(BOB, 'en');
    app.publisher.failingOwners.add(BOB);
    await runAt(app, NOV_02_0900);
    const logged = JSON.stringify(app.failures);
    for (const leaked of ['Secret', 'Visa', '4000000', 'storage', 'en', 'Buenos_Aires']) {
      expect(logged).not.toContain(leaked);
    }
    expect(Object.keys(app.failures[0] ?? {}).sort()).toEqual(['cardId', 'errorName']);
  });

  it('propagates a storage failure of a whole page to the caller', async () => {
    const app = setup();
    app.source.failWith = new Error('page down');
    await expect(app.job.execute()).rejects.toThrow('page down');
  });
});
