import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { GetCreditCard } from '../../src/credit-cards/application/get-credit-card';
import { SetCardDebitAccounts } from '../../src/credit-cards/application/set-card-debit-accounts';
import {
  DebitAccountArchived,
  DebitAccountCurrencyMismatch,
  DebitAccountIsCardAccount,
} from '../../src/credit-cards/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeActivity,
  FakeCardPurchases,
  FakeClock,
  FakeDebitAccounts,
  FakeExpenseRecorder,
  FakeTimeZones,
  InMemoryCreditCards,
  installmentFakes,
  writeScopeFor,
} from './fakes';

const ANA = 'ana';
const BOB = 'bob';
const visa = { name: 'Visa', closingDay: 24, dueDay: 5 };

function setup(now = '2026-10-06T12:00:00.000Z') {
  const cards = new InMemoryCreditCards();
  const timeZones = new FakeTimeZones();
  const clock = new FakeClock(new Date(now));
  const expenses = new FakeExpenseRecorder(clock);
  const debitAccounts = new FakeDebitAccounts();
  const deps = {
    cards,
    activity: new FakeActivity(),
    timeZones,
    clock,
    purchases: new FakeCardPurchases(expenses),
    expenses,
    ...installmentFakes(),
    debitAccounts,
  };
  return {
    cards,
    clock,
    debitAccounts,
    create: new CreateCreditCard(deps),
    get: new GetCreditCard(deps),
    setDebit: new SetCardDebitAccounts(deps),
  };
}

async function withCard() {
  const app = setup();
  const scope = await writeScopeFor(ANA);
  const card = await app.create.execute(scope, visa);
  const bankArs = app.debitAccounts.add(ANA, 'ARS');
  const bankUsd = app.debitAccounts.add(ANA, 'USD');
  return { app, scope, card, bankArs, bankUsd };
}

describe('SetCardDebitAccounts', () => {
  it('starts with no debit accounts', async () => {
    const { card } = await withCard();
    expect(card.debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('links an ARS bank account with today and the card reads it back (AC-01)', async () => {
    const { app, scope, card, bankArs } = await withCard();

    const saved = await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });

    expect(saved.debitAccounts.ARS).toEqual({ accountId: bankArs, linkedOn: '2026-10-06' });
    const read = await app.get.execute(scope, card.id);
    expect(read.debitAccounts.ARS).toEqual({ accountId: bankArs, linkedOn: '2026-10-06' });
  });

  it('links only ARS, leaves USD null, and null clears the link and its date (AC-04)', async () => {
    const { app, scope, card, bankArs } = await withCard();
    const linked = await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });
    expect(linked.debitAccounts.USD).toBeNull();

    const cleared = await app.setDebit.execute(scope, card.id, { ARS: null, USD: null });

    expect(cleared.debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('keeps linkedOn when the account is unchanged and sets today when it changes (AC-01)', async () => {
    const { app, scope, card, bankArs } = await withCard();
    const otherArs = app.debitAccounts.add(ANA, 'ARS');
    await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });

    app.clock.current = new Date('2026-10-20T12:00:00.000Z');
    const same = await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });
    expect(same.debitAccounts.ARS).toEqual({ accountId: bankArs, linkedOn: '2026-10-06' });

    const changed = await app.setDebit.execute(scope, card.id, { ARS: otherArs, USD: null });
    expect(changed.debitAccounts.ARS).toEqual({ accountId: otherArs, linkedOn: '2026-10-20' });
  });

  it('rejects a USD account linked for ARS and saves nothing (AC-02)', async () => {
    const { app, scope, card, bankUsd } = await withCard();

    await expect(app.setDebit.execute(scope, card.id, { ARS: bankUsd, USD: null })).rejects.toThrow(
      DebitAccountCurrencyMismatch,
    );

    expect((await app.get.execute(scope, card.id)).debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it("rejects the card's own accounts and another card's linked account (AC-05)", async () => {
    const { app, scope, card } = await withCard();
    const other = await app.create.execute(scope, { name: 'Master', closingDay: 10, dueDay: 20 });
    app.debitAccounts.addExisting(ANA, card.arsAccountId, 'ARS');
    app.debitAccounts.addExisting(ANA, card.usdAccountId, 'USD');
    app.debitAccounts.addExisting(ANA, other.arsAccountId, 'ARS');

    await expect(
      app.setDebit.execute(scope, card.id, { ARS: card.arsAccountId, USD: null }),
    ).rejects.toThrow(DebitAccountIsCardAccount);
    await expect(
      app.setDebit.execute(scope, card.id, { ARS: null, USD: card.usdAccountId }),
    ).rejects.toThrow(DebitAccountIsCardAccount);
    await expect(
      app.setDebit.execute(scope, card.id, { ARS: other.arsAccountId, USD: null }),
    ).rejects.toThrow(DebitAccountIsCardAccount);
    expect((await app.get.execute(scope, card.id)).debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('answers ResourceNotFound for another user account and an unknown id (AC-05)', async () => {
    const { app, scope, card } = await withCard();
    const bobs = app.debitAccounts.add(BOB, 'ARS');

    await expect(app.setDebit.execute(scope, card.id, { ARS: bobs, USD: null })).rejects.toThrow(
      ResourceNotFound,
    );
    await expect(
      app.setDebit.execute(scope, card.id, {
        ARS: '00000000-0000-4000-8000-000000000000',
        USD: null,
      }),
    ).rejects.toThrow(ResourceNotFound);
    expect((await app.get.execute(scope, card.id)).debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('saves neither currency when one of them is invalid (AC-02, atomic)', async () => {
    const { app, scope, card, bankArs } = await withCard();
    const bobs = app.debitAccounts.add(BOB, 'USD');

    await expect(app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: bobs })).rejects.toThrow(
      ResourceNotFound,
    );

    expect((await app.get.execute(scope, card.id)).debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('rejects an archived account as a new link and accepts it when already linked (FR-01)', async () => {
    const { app, scope, card, bankArs } = await withCard();
    const archived = app.debitAccounts.add(ANA, 'ARS', { archived: true });

    await expect(
      app.setDebit.execute(scope, card.id, { ARS: archived, USD: null }),
    ).rejects.toThrow(DebitAccountArchived);

    await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });
    app.debitAccounts.archive(bankArs);
    const again = await app.setDebit.execute(scope, card.id, { ARS: bankArs, USD: null });
    expect(again.debitAccounts.ARS?.accountId).toBe(bankArs);
  });

  it('answers ResourceNotFound for another user card and reads no account (AC-05)', async () => {
    const { app, card, bankArs } = await withCard();
    const bobScope = await writeScopeFor(BOB);
    const before = app.debitAccounts.reads;

    await expect(
      app.setDebit.execute(bobScope, card.id, { ARS: bankArs, USD: null }),
    ).rejects.toThrow(ResourceNotFound);

    expect(app.debitAccounts.reads).toBe(before);
  });
});
