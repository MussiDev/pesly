import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateAccount,
  GetAvailableTotals,
  ListAccounts,
  SetAccountArchived,
} from '../../src/accounts';
import {
  FakeAccountLinks,
  FakeAccountMovements,
  InMemoryAccountRepository,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let accounts: InMemoryAccountRepository;
let movements: FakeAccountMovements;
let create: CreateAccount;
let archive: SetAccountArchived;
let available: GetAvailableTotals;
let list: ListAccounts;

beforeEach(() => {
  accounts = new InMemoryAccountRepository();
  movements = new FakeAccountMovements();
  const deps = { accounts, movements, links: new FakeAccountLinks() };
  create = new CreateAccount(deps);
  archive = new SetAccountArchived(deps);
  available = new GetAvailableTotals(deps);
  list = new ListAccounts(deps);
});

type SeedType = 'cash' | 'bank_account' | 'digital_wallet' | 'savings' | 'credit_card';

async function add(
  userId: string,
  name: string,
  type: SeedType,
  extra: { currency?: 'ARS' | 'USD'; opening?: bigint; include?: boolean } = {},
) {
  return create.execute(await writeScopeFor(userId), {
    name,
    type,
    currency: extra.currency ?? 'ARS',
    openingBalance: extra.opening ?? 0n,
    ...(extra.include === undefined ? {} : { includeInAvailable: extra.include }),
  });
}

describe('GetAvailableTotals', () => {
  it('sums opening balance plus movements of the included active accounts per currency', async () => {
    const cash = await add(ALICE, 'Cash', 'cash', { opening: 1000n });
    await add(ALICE, 'Wallet', 'digital_wallet', { currency: 'USD', opening: 50n });
    movements.sums.set(cash.id, -100n);

    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 900n, USD: 50n });
  });

  it('is zero for both currencies without accounts', async () => {
    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 0n, USD: 0n });
  });

  it('excludes an archived account', async () => {
    await add(ALICE, 'Cash', 'cash', { opening: 100n });
    const old = await add(ALICE, 'Old', 'bank_account', { opening: 5000n });
    await archive.execute(await writeScopeFor(ALICE), old.id, true);

    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 100n, USD: 0n });
  });

  it('respects the include-in-available flag', async () => {
    await add(ALICE, 'Cash', 'cash', { opening: 100n });
    await add(ALICE, 'Off', 'cash', { opening: 7000n, include: false });

    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 100n, USD: 0n });
  });

  it('does not subtract credit-card debt', async () => {
    await add(ALICE, 'Cash', 'cash', { opening: 100n });
    const card = await add(ALICE, 'Visa', 'credit_card');
    movements.sums.set(card.id, -3000n);

    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 100n, USD: 0n });
  });

  it("never counts another user's accounts", async () => {
    await add(ALICE, 'Cash', 'cash', { opening: 100n });
    await add(BOB, 'Theirs', 'cash', { opening: 9999n });

    expect(await available.execute(await readScopeFor(ALICE))).toEqual({ ARS: 100n, USD: 0n });
  });

  it('gives the same result as ListAccounts.availableTotals', async () => {
    const cash = await add(ALICE, 'Cash', 'cash', { opening: 1000n });
    await add(ALICE, 'Usd', 'savings', { currency: 'USD', opening: 900n });
    await add(ALICE, 'Off', 'cash', { opening: 10n, include: false });
    const card = await add(ALICE, 'Visa', 'credit_card');
    movements.sums.set(cash.id, 250n);
    movements.sums.set(card.id, -3000n);
    const scope = await readScopeFor(ALICE);

    const listed = await list.execute(scope, { archived: false, limit: 1, offset: 0 });

    expect(await available.execute(scope)).toEqual(listed.availableTotals);
  });

  it('propagates a movements read failure', async () => {
    await add(ALICE, 'Cash', 'cash', { opening: 1n });
    movements.sumsByAccount = () => Promise.reject(new Error('movements down'));

    await expect(available.execute(await readScopeFor(ALICE))).rejects.toThrow('movements down');
  });
});
