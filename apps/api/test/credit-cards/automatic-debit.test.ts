import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { ensureStatements } from '../../src/credit-cards/application/ensure-statements';
import {
  RecordAutomaticDebits,
  type DebitFailure,
  type DebitInfo,
  type DebitSummary,
} from '../../src/credit-cards/application/record-automatic-debits';
import type { CreditCard, Statement } from '../../src/credit-cards/domain/credit-card';
import {
  AUTOMATIC_DEBIT_DUE_TIME,
  automaticDebitMovementId,
  debitCandidates,
  settledKey,
  unpaidRemainder,
} from '../../src/credit-cards/domain/automatic-debit';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeActivity,
  FakeAutomaticDebitRecorder,
  FakeAutomaticDebitSource,
  FakeCardPurchases,
  FakeClock,
  FakeExpenseRecorder,
  FakeTimeZones,
  InMemoryAutomaticDebitLog,
  InMemoryCreditCards,
  installmentFakes,
  writeScopeFor,
} from './fakes';

const ANA = 'ana';
const ARS_BANK = '7c1f6a40-0000-4000-8000-0000000000a1';
const USD_BANK = '7c1f6a40-0000-4000-8000-0000000000b2';
const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };
/** Statement 2026-10 closes on 2026-10-24 and is due on 2026-11-05. */
const DUE_DAY = '2026-11-05';
/** Buenos Aires is UTC-3, so 06:00 local on the due day is 09:00Z. */
const AT_0559 = '2026-11-05T08:59:00.000Z';
const AT_0600 = '2026-11-05T09:00:00.000Z';
const AT_0610 = '2026-11-05T09:10:00.000Z';

class ArchivedAccount extends AppError {
  constructor() {
    super('ACCOUNT_ARCHIVED');
  }
}

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
  const log = new InMemoryAutomaticDebitLog();
  const recorder = new FakeAutomaticDebitRecorder(fakes.paymentRecorder);
  const failures: DebitFailure[] = [];
  const infos: DebitInfo[] = [];
  const job = new RecordAutomaticDebits({
    cards,
    purchases: deps.purchases,
    installments: fakes.installments,
    cardPayments: fakes.cardPayments,
    clock,
    source: new FakeAutomaticDebitSource(cards, timeZones),
    log,
    recorder,
    scopeFor: writeScopeFor,
    report: (failure) => failures.push(failure),
    info: (info) => infos.push(info),
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  return {
    cards,
    clock,
    expenses,
    log,
    recorder,
    transfers: fakes.paymentRecorder,
    failures,
    infos,
    job,
    create: new CreateCreditCard(deps),
  };
}

type App = ReturnType<typeof setup>;

/** A card whose ARS (and optionally USD) debit account is linked on `linkedOn`, with its spending. */
async function cardWithDebit(
  app: App,
  options: {
    name?: string;
    ars?: bigint;
    usd?: bigint;
    debitArs?: boolean;
    debitUsd?: boolean;
    linkedOn?: string;
  } = {},
): Promise<CreditCard> {
  const scope = await writeScopeFor(ANA);
  const card = await app.create.execute(scope, { ...visa, name: options.name ?? visa.name });
  const spend = async (accountId: string, amount: bigint, occurredAt: string) => {
    await app.expenses.record(scope, {
      accountId,
      categoryId: 'category',
      amount,
      occurredAt: new Date(occurredAt),
      rate: { source: 'automatic' },
    });
  };
  await spend(card.arsAccountId, options.ars ?? 4_000_000n, '2026-10-05T15:00:00.000Z');
  if (options.usd) await spend(card.usdAccountId, options.usd, '2026-10-05T15:00:00.000Z');
  const linkedOn = options.linkedOn ?? '2026-10-06';
  await app.cards.updateDebitAccounts(scope, card.id, {
    ARS: options.debitArs === false ? null : { accountId: ARS_BANK, linkedOn },
    USD: options.debitUsd ? { accountId: USD_BANK, linkedOn } : null,
  });
  return card;
}

async function runAt(app: App, instant: string): Promise<DebitSummary> {
  app.clock.current = new Date(instant);
  return app.job.execute();
}

describe('automatic debit domain', () => {
  const statement = (period: string, dueDate: string): Statement => ({
    id: period,
    cardId: 'card',
    period,
    closingDate: '2026-01-01',
    dueDate,
  });
  const links = {
    ARS: { accountId: 'a', linkedOn: '2026-10-06' },
    USD: null,
  };

  it('gives the same movement id for the same key and another for any change (NFR-03)', () => {
    const id = automaticDebitMovementId('card-1', '2026-10', 'ARS');
    expect(automaticDebitMovementId('card-1', '2026-10', 'ARS')).toBe(id);
    expect(automaticDebitMovementId('card-1', '2026-11', 'ARS')).not.toBe(id);
    expect(automaticDebitMovementId('card-1', '2026-10', 'USD')).not.toBe(id);
    expect(automaticDebitMovementId('card-2', '2026-10', 'ARS')).not.toBe(id);
  });

  it('shapes the movement id as a UUID with version nibble 8 and variant 10 (D2)', () => {
    expect(automaticDebitMovementId('card-1', '2026-10', 'ARS')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('derives the id from the real SHA-256 of the key, also for long and non-ASCII ids (D2)', () => {
    for (const cardId of ['card-1', 'x'.repeat(100), 'tarjeta-ñ-€']) {
      const bytes = createHash('sha256')
        .update(`pesly:automatic-debit:${cardId}:2026-10:USD`)
        .digest()
        .subarray(0, 16);
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = bytes.toString('hex');
      const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      expect(automaticDebitMovementId(cardId, '2026-10', 'USD')).toBe(expected);
    }
  });

  it('lists the due statements oldest first and drops the settled and the not yet due (D3)', () => {
    const candidates = debitCandidates({
      statements: [
        statement('2026-11', '2026-12-05'),
        statement('2026-10', '2026-11-05'),
        statement('2026-09', '2026-10-05'),
        statement('2026-08', '2026-09-05'),
      ],
      debitAccounts: { ...links, ARS: { accountId: 'a', linkedOn: '2026-10-05' } },
      settled: new Set([settledKey('2026-10', 'ARS')]),
      lastDue: '2026-12-05',
    });
    // 2026-08 is due before the link date, 2026-10 is settled.
    expect(candidates.map((c) => [c.statement.period, c.currency])).toEqual([
      ['2026-09', 'ARS'],
      ['2026-11', 'ARS'],
    ]);
    expect(candidates[0]?.link.accountId).toBe('a');
  });

  it('excludes a statement due after lastDue and includes the one due on lastDue (D3)', () => {
    const statements = [statement('2026-10', '2026-11-05')];
    const input = { statements, debitAccounts: links, settled: new Set<string>() };
    expect(debitCandidates({ ...input, lastDue: '2026-11-04' })).toEqual([]);
    expect(debitCandidates({ ...input, lastDue: '2026-11-05' })).toHaveLength(1);
  });

  it('returns nothing without a debit account in that currency (AC-04)', () => {
    const candidates = debitCandidates({
      statements: [statement('2026-10', '2026-11-05')],
      debitAccounts: { ARS: null, USD: null },
      settled: new Set(),
      lastDue: '2027-01-01',
    });
    expect(candidates).toEqual([]);
  });

  it('computes the remainder as total minus paid and never below zero (D5)', () => {
    expect(unpaidRemainder(4_000_000n, 1_500_000n)).toBe(2_500_000n);
    expect(unpaidRemainder(4_000_000n, 4_000_000n)).toBe(0n);
    expect(unpaidRemainder(0n, 0n)).toBe(0n);
    expect(unpaidRemainder(1_000n, 5_000n)).toBe(0n);
  });

  it('starts counting a debit as due at 06:00 local', () => {
    expect(AUTOMATIC_DEBIT_DUE_TIME).toBe('06:00');
  });
});

describe('RecordAutomaticDebits', () => {
  it('records one transfer of the unpaid ARS remainder from the debit to the card account (AC-03)', async () => {
    const app = setup();
    const card = await cardWithDebit(app);
    const summary = await runAt(app, AT_0610);
    expect(app.transfers.payments).toHaveLength(1);
    expect(app.transfers.payments[0]).toMatchObject({
      ownerId: ANA,
      sourceAccountId: ARS_BANK,
      destinationAccountId: card.arsAccountId,
      amount: 4_000_000n,
      id: automaticDebitMovementId(card.id, '2026-10', 'ARS'),
    });
    expect(app.transfers.payments[0]?.note).toBeUndefined();
    expect(summary).toMatchObject({ cards: 1, recorded: 1, failed: 0 });
  });

  it('dates the transfer at noon of the due day in the owner zone (D9)', async () => {
    const app = setup();
    await cardWithDebit(app);
    await runAt(app, AT_0610);
    expect(app.transfers.payments[0]?.occurredAt.toISOString()).toBe(`${DUE_DAY}T15:00:00.000Z`);
  });

  it('records nothing in USD for a card with only an ARS debit account (AC-04)', async () => {
    const app = setup();
    await cardWithDebit(app, { usd: 5_000n });
    await runAt(app, AT_0610);
    expect(app.transfers.payments.map((p) => p.sourceAccountId)).toEqual([ARS_BANK]);
  });

  it('records one ARS and one USD transfer, each with its own remainder (FR-02)', async () => {
    const app = setup();
    const card = await cardWithDebit(app, { usd: 5_000n, debitUsd: true });
    await runAt(app, AT_0610);
    const byDestination = new Map(app.transfers.payments.map((p) => [p.destinationAccountId, p]));
    expect(app.transfers.payments).toHaveLength(2);
    expect(byDestination.get(card.arsAccountId)).toMatchObject({
      sourceAccountId: ARS_BANK,
      amount: 4_000_000n,
    });
    expect(byDestination.get(card.usdAccountId)).toMatchObject({
      sourceAccountId: USD_BANK,
      amount: 5_000n,
    });
    expect(app.transfers.payments.every((p) => p.pesosDebited === undefined)).toBe(true);
  });

  it('records nothing when payments cover the total and settles it as covered (AC-06)', async () => {
    const app = setup();
    const card = await cardWithDebit(app);
    app.transfers.payments.push({
      ownerId: ANA,
      id: 'by-hand',
      sourceAccountId: ARS_BANK,
      destinationAccountId: card.arsAccountId,
      amount: 4_000_000n,
      occurredAt: new Date('2026-11-01T15:00:00.000Z'),
    });
    const summary = await runAt(app, AT_0610);
    expect(app.transfers.payments).toHaveLength(1);
    expect(app.recorder.calls).toBe(0);
    expect(summary.skippedCovered).toBe(1);
    expect([...app.log.rows.values()]).toEqual([{ status: 'skipped', reason: 'covered' }]);
  });

  it('records nothing in a currency whose statement total is 0 (FR-03)', async () => {
    const app = setup();
    await cardWithDebit(app, { debitUsd: true });
    const summary = await runAt(app, AT_0610);
    expect(app.transfers.payments.map((p) => p.sourceAccountId)).toEqual([ARS_BANK]);
    expect(summary.skippedCovered).toBe(1);
  });

  it('debits only what is left after a payment made by hand before the due date (AC-11)', async () => {
    const app = setup();
    const card = await cardWithDebit(app);
    app.transfers.payments.push({
      ownerId: ANA,
      id: 'by-hand',
      sourceAccountId: ARS_BANK,
      destinationAccountId: card.arsAccountId,
      amount: 1_500_000n,
      occurredAt: new Date('2026-11-01T15:00:00.000Z'),
    });
    await runAt(app, AT_0610);
    const automatic = app.transfers.payments.find((p) => p.id !== 'by-hand');
    expect(automatic?.amount).toBe(2_500_000n);
  });

  it('settles skipped as account_unavailable when the account is archived and never retries (AC-07)', async () => {
    const app = setup();
    await cardWithDebit(app);
    app.recorder.failures.set(ARS_BANK, new ArchivedAccount());
    const first = await runAt(app, AT_0610);
    expect(app.transfers.payments).toEqual([]);
    expect(first.skippedUnavailable).toBe(1);
    expect([...app.log.rows.values()]).toEqual([
      { status: 'skipped', reason: 'account_unavailable' },
    ]);
    app.recorder.failures.clear();
    const second = await runAt(app, AT_0610);
    expect(app.transfers.payments).toEqual([]);
    expect(second.alreadySettled).toBe(0);
    expect(app.recorder.calls).toBe(1);
  });

  it('settles skipped when the debit account no longer exists (FR-04)', async () => {
    const app = setup();
    await cardWithDebit(app);
    app.recorder.failures.set(ARS_BANK, new ResourceNotFound());
    const summary = await runAt(app, AT_0610);
    expect(app.transfers.payments).toEqual([]);
    expect(summary.skippedUnavailable).toBe(1);
    expect([...app.log.rows.values()]).toEqual([
      { status: 'skipped', reason: 'account_unavailable' },
    ]);
  });

  it('settles skipped as refused for any other domain error (FR-04)', async () => {
    const app = setup();
    await cardWithDebit(app);
    app.recorder.failures.set(ARS_BANK, new AppError('MOVEMENT_DATE_IN_FUTURE'));
    const summary = await runAt(app, AT_0610);
    expect(app.transfers.payments).toEqual([]);
    expect(summary.skippedRefused).toBe(1);
    expect([...app.log.rows.values()]).toEqual([{ status: 'skipped', reason: 'refused' }]);
  });

  it('records nothing at 05:59 local on the due date and records at 06:00 (NFR-02)', async () => {
    const app = setup();
    await cardWithDebit(app);
    await runAt(app, AT_0559);
    expect(app.transfers.payments).toEqual([]);
    await runAt(app, AT_0600);
    expect(app.transfers.payments).toHaveLength(1);
  });

  it('has recorded the transfer by a pass at 06:10 local (AC-08)', async () => {
    const app = setup();
    await cardWithDebit(app);
    await runAt(app, AT_0610);
    expect(app.transfers.payments).toHaveLength(1);
  });

  it('records once on the first pass days after the due date (AC-10)', async () => {
    const app = setup();
    await cardWithDebit(app);
    await runAt(app, '2026-11-12T15:00:00.000Z');
    await runAt(app, '2026-11-12T15:01:00.000Z');
    expect(app.transfers.payments).toHaveLength(1);
  });

  it('never debits a statement due before the link date and debits one due on it (AC-10)', async () => {
    const before = setup();
    await cardWithDebit(before, { linkedOn: '2026-11-06' });
    await runAt(before, '2026-11-06T15:00:00.000Z');
    expect(before.transfers.payments).toEqual([]);

    const onTheDay = setup();
    await cardWithDebit(onTheDay, { linkedOn: DUE_DAY });
    await runAt(onTheDay, '2026-11-06T15:00:00.000Z');
    expect(onTheDay.transfers.payments).toHaveLength(1);
  });

  it('takes the 06:00 from the owner zone, not the process zone (NFR-02)', async () => {
    const app = setup('Asia/Tokyo');
    await cardWithDebit(app);
    // 05:59 and 06:00 on 2026-11-05 in Tokyo (UTC+9).
    await runAt(app, '2026-11-04T20:59:00.000Z');
    expect(app.transfers.payments).toEqual([]);
    await runAt(app, '2026-11-04T21:00:00.000Z');
    expect(app.transfers.payments).toHaveLength(1);
  });

  it('records 1 transfer over two sequential passes and reports alreadySettled (AC-09)', async () => {
    const app = setup();
    await cardWithDebit(app);
    const first = await runAt(app, AT_0610);
    const second = await runAt(app, AT_0610);
    expect(app.transfers.payments).toHaveLength(1);
    expect(first.recorded).toBe(1);
    expect(second.recorded).toBe(0);
    expect(app.recorder.calls).toBe(1);
  });

  it('counts alreadySettled when another pass settles the key between read and claim (AC-09)', async () => {
    const app = setup();
    const card = await cardWithDebit(app);
    // The key is settled after `settledKeys` was read: the claim finds it settled.
    const read = app.log.settledKeys.bind(app.log);
    app.log.settledKeys = async (scope, cardId) => {
      const keys = await read(scope, cardId);
      app.log.rows.set(`${scope.userId}|${card.id}|2026-10|ARS`, {
        status: 'skipped',
        reason: 'covered',
      });
      return keys;
    };
    const summary = await runAt(app, AT_0610);
    expect(summary.alreadySettled).toBe(1);
    expect(app.transfers.payments).toEqual([]);
  });

  it('processes two statements due the same day oldest first with their own remainders (D5)', async () => {
    const app = setup();
    const scope = await writeScopeFor(ANA);
    const card = await cardWithDebit(app);
    app.clock.current = new Date('2026-10-31T12:00:00.000Z');
    // A purchase of 30,000.00 ARS after the October closing belongs to the next statement.
    await app.expenses.record(scope, {
      accountId: card.arsAccountId,
      categoryId: 'category',
      amount: 3_000_000n,
      occurredAt: new Date('2026-10-30T15:00:00.000Z'),
      rate: { source: 'automatic' },
    });
    // Make November closed and due the same day as October.
    const statements = await ensureStatements(app.cards, scope, card, '2026-10-31');
    const november = statements.find((s) => s.period === '2026-11');
    if (!november) throw new Error('missing November statement');
    await app.cards.updateStatement(scope, card.id, november.id, {
      closingDate: '2026-11-01',
      dueDate: DUE_DAY,
    });
    await runAt(app, AT_0610);
    expect(app.transfers.payments.map((p) => p.amount)).toEqual([4_000_000n, 3_000_000n]);
    expect(app.transfers.payments.map((p) => p.id)).toEqual([
      automaticDebitMovementId(card.id, '2026-10', 'ARS'),
      automaticDebitMovementId(card.id, '2026-11', 'ARS'),
    ]);
  });

  it('reports a plain Error with ids and class name only, rolls back and retries next pass (NFR-03)', async () => {
    const app = setup();
    const card = await cardWithDebit(app);
    app.recorder.failures.set(ARS_BANK, new Error('storage down amount 4000000 Visa'));
    const first = await runAt(app, AT_0610);
    expect(first.failed).toBe(1);
    expect(app.failures).toEqual([
      { cardId: card.id, period: '2026-10', currency: 'ARS', errorName: 'Error' },
    ]);
    expect(app.log.rows.size).toBe(0);
    expect((await app.log.settledKeys(await writeScopeFor(ANA), card.id)).size).toBe(0);
    app.recorder.failures.clear();
    const second = await runAt(app, AT_0610);
    expect(second.recorded).toBe(1);
    expect(app.transfers.payments).toHaveLength(1);
  });

  it('reports an error in one card with ids only and still processes the next card (NFR-03)', async () => {
    const app = setup();
    const broken = await cardWithDebit(app, { name: 'Broken' });
    const healthy = await cardWithDebit(app, { name: 'Healthy' });
    app.log.failingCards.add(broken.id);
    const summary = await runAt(app, AT_0610);
    expect(summary).toMatchObject({ cards: 2, failed: 1, recorded: 1 });
    expect(app.failures).toEqual([
      { cardId: broken.id, period: null, currency: null, errorName: 'Error' },
    ]);
    expect(app.transfers.payments.map((p) => p.destinationAccountId)).toEqual([
      healthy.arsAccountId,
    ]);
  });

  it('pages through every card of the source one page at a time', async () => {
    const app = setup('America/Argentina/Buenos_Aires', 1);
    await cardWithDebit(app, { name: 'One' });
    await cardWithDebit(app, { name: 'Two' });
    await cardWithDebit(app, { name: 'Three' });
    const summary = await runAt(app, AT_0610);
    expect(summary).toMatchObject({ cards: 3, recorded: 3 });
  });

  it('puts no amount, account name or card name in the failures and info lines (NFR-01)', async () => {
    const refused = setup();
    await cardWithDebit(refused);
    refused.recorder.failures.set(
      ARS_BANK,
      new AppError('MOVEMENT_DATE_IN_FUTURE', 'Visa 4000000'),
    );
    await runAt(refused, AT_0610);
    const recorded = setup();
    await cardWithDebit(recorded);
    await runAt(recorded, AT_0610);
    const broken = setup();
    await cardWithDebit(broken);
    broken.recorder.failures.set(ARS_BANK, new Error('Visa 4000000'));
    await runAt(broken, AT_0610);
    const apps = [refused, recorded, broken];
    const text = JSON.stringify(apps.map((a) => [a.failures, a.infos]));
    expect(apps.flatMap((a) => a.infos).length).toBeGreaterThan(0);
    expect(broken.failures.length).toBeGreaterThan(0);
    for (const secret of ['4000000', 'Visa', ARS_BANK]) {
      expect(text).not.toContain(secret);
    }
  });
});
