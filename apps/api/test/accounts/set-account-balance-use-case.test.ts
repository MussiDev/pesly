import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountArchived,
  AccountIsCreditCard,
  BalanceDifferenceOutOfRange,
  SetAccountBalance,
} from '../../src/accounts';
import { RateLimited, TotpInvalid } from '../../src/identity/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeAccountMovements,
  FakeBalanceAdjuster,
  FakeSecondFactorGate,
  InMemoryAccountRepository,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let accounts: InMemoryAccountRepository;
let movements: FakeAccountMovements;
let adjuster: FakeBalanceAdjuster;
let gate: FakeSecondFactorGate;
let setBalance: SetAccountBalance;

beforeEach(() => {
  accounts = new InMemoryAccountRepository();
  movements = new FakeAccountMovements();
  adjuster = new FakeBalanceAdjuster(accounts, movements);
  gate = new FakeSecondFactorGate();
  setBalance = new SetAccountBalance({ accounts, adjuster, secondFactor: gate });
});

async function run(
  userId: string,
  accountId: string,
  balance: bigint,
  extra: { note?: string; secondFactorCode?: string } = {},
) {
  return setBalance.execute(await writeScopeFor(userId), { accountId, balance, ...extra });
}

describe('SetAccountBalance', () => {
  it('records target minus current when the target is above and below the balance (AC-01)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja', openingBalance: 1000n });

    const up = await run(ALICE, account.id, 1500n);
    expect(up.adjustment?.amount).toBe(500n);
    expect(up.account.balance).toBe(1500n);

    const down = await run(ALICE, account.id, 200n);
    expect(down.adjustment?.amount).toBe(-1300n);
    expect(down.account.balance).toBe(200n);
  });

  it('passes the owner from the scope and the note to the adjuster, never an amount from the caller (AC-02, R-01)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja' });
    await run(ALICE, account.id, 700n, { note: 'cash count' });
    expect(adjuster.requests).toEqual([
      { ownerId: ALICE, accountId: account.id, target: 700n, note: 'cash count' },
    ]);
    expect(adjuster.recorded[0]?.note).toBe('cash count');
  });

  it('returns adjustment null and records nothing when the target equals the balance (AC-11)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja', openingBalance: 900n });
    const result = await run(ALICE, account.id, 900n);
    expect(result.adjustment).toBeNull();
    expect(result.account.balance).toBe(900n);
    expect(adjuster.recorded).toHaveLength(0);
  });

  it('accepts a negative target (AC-12)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja', openingBalance: 100n });
    const result = await run(ALICE, account.id, -400n);
    expect(result.adjustment?.amount).toBe(-500n);
    expect(result.account.balance).toBe(-400n);
  });

  it('asks the second factor with the caller and the code before any write (AC-19)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja' });
    await run(ALICE, account.id, 10n, { secondFactorCode: '123456' });
    expect(gate.calls).toEqual([{ userId: ALICE, code: '123456' }]);
  });

  it.each([new TotpInvalid(), new RateLimited()])(
    'records nothing when the second factor fails with %s (AC-20) (sad path)',
    async (failure) => {
      const account = accounts.seed(ALICE, { name: 'Caja' });
      gate.failure = failure;
      await expect(run(ALICE, account.id, 10n)).rejects.toBe(failure);
      expect(adjuster.requests).toHaveLength(0);
    },
  );

  it('answers not found for a missing account and for another user account (AC-16) (sad path)', async () => {
    const theirs = accounts.seed(BOB, { name: 'Theirs' });
    await expect(run(ALICE, theirs.id, 10n)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(run(ALICE, '33333333-3333-4333-8333-333333333333', 10n)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(adjuster.recorded).toHaveLength(0);
  });

  it('refuses an archived account with AccountArchived (AC-14) (sad path)', async () => {
    const archived = accounts.seed(ALICE, { name: 'Old', archived: true });
    await expect(run(ALICE, archived.id, 10n)).rejects.toBeInstanceOf(AccountArchived);
    expect(adjuster.recorded).toHaveLength(0);
  });

  it('refuses a credit card account with AccountIsCreditCard (sad path)', async () => {
    const card = accounts.seed(ALICE, { name: 'Visa', type: 'credit_card' });
    await expect(run(ALICE, card.id, 10n)).rejects.toBeInstanceOf(AccountIsCreditCard);
    expect(adjuster.recorded).toHaveLength(0);
  });

  it('refuses a difference the adjuster reports out of range, naming body.balance (sad path)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja' });
    const useCase = new SetAccountBalance({
      accounts,
      adjuster: { adjust: () => Promise.resolve({ status: 'out_of_range' }) },
      secondFactor: gate,
    });
    const attempt = useCase.execute(await writeScopeFor(ALICE), {
      accountId: account.id,
      balance: 5n,
    });
    await expect(attempt).rejects.toBeInstanceOf(BalanceDifferenceOutOfRange);
    await expect(attempt).rejects.toMatchObject({ fields: ['body.balance'] });
  });

  it('answers not found when the account vanished after the adjustment (sad path)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja' });
    const vanishing = new FakeBalanceAdjuster(accounts, movements);
    const original = vanishing.adjust.bind(vanishing);
    vanishing.adjust = async (request) => {
      const result = await original(request);
      accounts.rows.delete(account.id);
      return result;
    };
    const useCase = new SetAccountBalance({ accounts, adjuster: vanishing, secondFactor: gate });
    await expect(
      useCase.execute(await writeScopeFor(ALICE), { accountId: account.id, balance: 5n }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('keeps the balance a bigint at the limit (NFR-03)', async () => {
    const account = accounts.seed(ALICE, { name: 'Caja' });
    const result = await run(ALICE, account.id, 10n ** 15n);
    expect(result.account.balance).toBe(10n ** 15n);
  });
});
