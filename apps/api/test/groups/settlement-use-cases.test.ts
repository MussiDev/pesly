import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, type AccountCurrency, type CreateGroupExpenseRequest } from '@pesly/shared';
import {
  AddGhostMember,
  ClaimGhostMember,
  CreateClaimLink,
  CreateGroup,
  CreateInvitation,
  GetBalances,
  JoinGroup,
  LeaveGroup,
  ListSettlements,
  MakeAdmin,
  PreviewConsolidation,
  RecordGroupExpense,
  RecordSettlement,
  RemoveMember,
  SetDefaultSplit,
  UpdateGroup,
  type GroupBalances,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { DeterministicTokenSource, FakeClock } from './fakes';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';
import {
  InMemoryGroupSettlementRepository,
  InMemoryMembershipGroupRepository,
  InMemoryRateReader,
  InMemorySettlementAccountChecker,
} from './settlement-fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const OUTSIDER_MEMBER = '88888888-8888-4888-8888-888888888888';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 1,000.0000 ARS per USD, scaled by 10,000. */
const RATE_1000 = 10_000_000n;

let clock: FakeClock;
let tokens: DeterministicTokenSource;
let groups: InMemoryMembershipGroupRepository;
let recorder: InMemoryPayerMovementRecorder;
let expenses: InMemoryGroupExpenseRepository;
let settlements: InMemoryGroupSettlementRepository;
let accounts: InMemorySettlementAccountChecker;
let rates: InMemoryRateReader;
let createGroup: CreateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let addGhost: AddGhostMember;
let createClaimLink: CreateClaimLink;
let claimGhost: ClaimGhostMember;
let updateGroup: UpdateGroup;
let setDefaultSplit: SetDefaultSplit;
let recordExpense: RecordGroupExpense;
let getBalances: GetBalances;
let record: RecordSettlement;
let preview: PreviewConsolidation;
let list: ListSettlements;
let remove: RemoveMember;
let leave: LeaveGroup;
let makeAdmin: MakeAdmin;

beforeEach(() => {
  clock = new FakeClock();
  tokens = new DeterministicTokenSource();
  groups = new InMemoryMembershipGroupRepository(clock);
  recorder = new InMemoryPayerMovementRecorder();
  expenses = new InMemoryGroupExpenseRepository(groups, recorder);
  settlements = new InMemoryGroupSettlementRepository(groups, expenses);
  accounts = new InMemorySettlementAccountChecker();
  rates = new InMemoryRateReader();
  const deps = {
    groups,
    clock,
    tokens,
    expenses,
    payerMovements: recorder,
    settlements,
    accounts,
    rates,
  };
  createGroup = new CreateGroup(deps);
  createInvitation = new CreateInvitation(deps);
  joinGroup = new JoinGroup(deps);
  addGhost = new AddGhostMember(deps);
  createClaimLink = new CreateClaimLink(deps);
  claimGhost = new ClaimGhostMember(deps);
  updateGroup = new UpdateGroup(deps);
  setDefaultSplit = new SetDefaultSplit(deps);
  recordExpense = new RecordGroupExpense(deps);
  getBalances = new GetBalances(deps);
  record = new RecordSettlement(deps);
  preview = new PreviewConsolidation(deps);
  list = new ListSettlements(deps);
  remove = new RemoveMember(deps);
  leave = new LeaveGroup(deps);
  makeAdmin = new MakeAdmin(deps);
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    if (error instanceof ResourceNotFound) return 'NOT_FOUND';
    throw error;
  }
  return 'no error';
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

interface Setup {
  groupId: string;
  alice: Member;
  bob: Member;
  carol: Member;
  ghost: Member;
  categoryId: string;
}

/** Alice (admin), Bob, Carol and a ghost "Pedro". */
async function setup(): Promise<Setup> {
  const created = await createGroup.execute(ALICE, { name: 'Casa', defaultRateType: 'blue' });
  const groupId = created.group.id;
  const first = await createInvitation.execute(ALICE, groupId);
  await joinGroup.execute(BOB, first.token);
  const second = await createInvitation.execute(ALICE, groupId);
  await joinGroup.execute(CAROL, second.token);
  clock.advance(1000);
  const ghost = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
  const [category] = await groups.listCategories(groupId);
  return {
    groupId,
    alice: (await groups.findMember(groupId, ALICE)) as Member,
    bob: (await groups.findMember(groupId, BOB)) as Member,
    carol: (await groups.findMember(groupId, CAROL)) as Member,
    ghost,
    categoryId: (category as { id: string }).id,
  };
}

/** `payer` pays `amount` and the listed members split it equally; Alice records it. */
async function expense(
  s: Setup,
  payer: Member,
  amount: string,
  currency: AccountCurrency,
  splitWith: Member[],
): Promise<void> {
  const request: CreateGroupExpenseRequest = {
    amount,
    currency,
    occurredAt: clock.now().toISOString(),
    payerMemberId: payer.id,
    categoryId: s.categoryId,
    description: 'Gasto',
    split: { mode: 'equal', memberIds: splitWith.map((m) => m.id) },
    // Alice records everything, so when she pays the movement needs one of her accounts.
    ...(payer.id === s.alice.id
      ? {
          payerAccount: {
            accountId: recorder.seedAccount(ALICE, currency),
            categoryId: recorder.seedCategory(ALICE),
          },
        }
      : {}),
  };
  await recordExpense.execute(ALICE, s.groupId, request);
}

function balanceOf(view: GroupBalances, currency: AccountCurrency, member: Member): bigint {
  return view[currency].members.find((m) => m.memberId === member.id)?.balance ?? 0n;
}

function sumOf(view: GroupBalances, currency: AccountCurrency): bigint {
  return view[currency].members.reduce((total, m) => total + m.balance, 0n);
}

function single(
  from: Member,
  to: Member,
  amount: string,
  overrides: { currency?: AccountCurrency; accountId?: string; occurredAt?: string } = {},
) {
  return {
    kind: 'single' as const,
    fromMemberId: from.id,
    toMemberId: to.id,
    currency: overrides.currency ?? 'ARS',
    amount,
    occurredAt: overrides.occurredAt ?? clock.now().toISOString(),
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
  };
}

function consolidated(
  a: Member,
  b: Member,
  legs: { ARS: string; USD: string },
  overrides: { currency?: AccountCurrency; rate?: string; accountId?: string } = {},
) {
  return {
    kind: 'consolidated' as const,
    memberIds: [a.id, b.id],
    currency: overrides.currency ?? 'USD',
    occurredAt: clock.now().toISOString(),
    legs,
    ...(overrides.rate !== undefined ? { rate: overrides.rate } : {}),
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
  };
}

/** Alice owes Bob 100.00 USD and Bob owes Alice 50,000.00 ARS. */
async function crossDebts(s: Setup): Promise<void> {
  await expense(s, s.bob, '20000', 'USD', [s.alice, s.bob]);
  await expense(s, s.alice, '10000000', 'ARS', [s.alice, s.bob]);
}

describe('GetBalances', () => {
  it('shows the balance of each member per currency after expenses in ARS and USD (AC-01)', async () => {
    const s = await setup();
    await expense(s, s.bob, '10000', 'ARS', [s.alice, s.bob]);
    await expense(s, s.alice, '3000', 'USD', [s.alice, s.bob, s.ghost]);

    const view = await getBalances.execute(ALICE, s.groupId);

    expect(balanceOf(view, 'ARS', s.alice)).toBe(-5000n);
    expect(balanceOf(view, 'ARS', s.bob)).toBe(5000n);
    expect(balanceOf(view, 'ARS', s.ghost)).toBe(0n);
    expect(balanceOf(view, 'USD', s.alice)).toBe(2000n);
    expect(balanceOf(view, 'USD', s.bob)).toBe(-1000n);
    expect(balanceOf(view, 'USD', s.ghost)).toBe(-1000n);
    expect(view.ARS.members.map((m) => m.memberId)).toContain(s.carol.id);
  });

  it('changes the ARS balances only when an ARS expense is recorded and keeps the sum at 0 (AC-02)', async () => {
    const s = await setup();
    await expense(s, s.alice, '3000', 'USD', [s.alice, s.bob]);
    const before = await getBalances.execute(ALICE, s.groupId);

    await expense(s, s.bob, '9999', 'ARS', [s.alice, s.bob, s.carol]);
    const after = await getBalances.execute(ALICE, s.groupId);

    expect(after.USD).toEqual(before.USD);
    expect(after.ARS).not.toEqual(before.ARS);
    expect(sumOf(after, 'ARS')).toBe(0n);
    expect(sumOf(after, 'USD')).toBe(0n);
  });

  it('lists the simplified payments and none when everyone is square (AC-03, AC-04)', async () => {
    const s = await setup();
    expect((await getBalances.execute(ALICE, s.groupId)).ARS.payments).toEqual([]);

    await expense(s, s.bob, '10000', 'ARS', [s.alice, s.bob]);
    const view = await getBalances.execute(ALICE, s.groupId);

    expect(view.ARS.payments).toEqual([{ from: s.alice.id, to: s.bob.id, amount: 5000n }]);
    expect(view.USD.payments).toEqual([]);
  });

  it('keeps a former member out of the list once their balance is 0 and the others in', async () => {
    const s = await setup();
    await remove.execute(ALICE, s.groupId, s.ghost.id);

    const view = await getBalances.execute(ALICE, s.groupId);

    expect(view.ARS.members.map((m) => m.memberId)).not.toContain(s.ghost.id);
    expect(view.ARS.members).toHaveLength(3);
  });
});

describe('RecordSettlement (single)', () => {
  it('reduces what A owes B by the amount settled (AC-05)', async () => {
    const s = await setup();
    await expense(s, s.bob, '10000000', 'ARS', [s.alice, s.bob]);

    const saved = await record.execute(ALICE, s.groupId, single(s.alice, s.bob, '3000000'));

    const view = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(view, 'ARS', s.alice)).toBe(-2000000n);
    expect(balanceOf(view, 'ARS', s.bob)).toBe(2000000n);
    expect(saved).toMatchObject({
      fromMemberId: s.alice.id,
      toMemberId: s.bob.id,
      currency: 'ARS',
      amount: 3000000n,
      legs: [{ currency: 'ARS', amount: 3000000n }],
      createdByMemberId: s.alice.id,
      rate: null,
      rateSource: null,
      accountId: null,
    });
    expect(sumOf(view, 'ARS')).toBe(0n);
  });

  it('allows paying more than is owed, which reverses the debt', async () => {
    const s = await setup();
    await expense(s, s.bob, '10000', 'ARS', [s.alice, s.bob]);

    await record.execute(ALICE, s.groupId, single(s.alice, s.bob, '8000'));

    const view = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(view, 'ARS', s.alice)).toBe(3000n);
    expect(balanceOf(view, 'ARS', s.bob)).toBe(-3000n);
  });

  it.each(['0', '-1'])('rejects an amount of %s as invalid (AC-06)', async (amount) => {
    const s = await setup();

    expect(await codeOf(record.execute(ALICE, s.groupId, single(s.alice, s.bob, amount)))).toBe(
      'VALIDATION_FAILED',
    );
    expect(settlements.settlements).toHaveLength(0);
  });

  it('rejects a date more than 1 day ahead as invalid and accepts exactly 1 day', async () => {
    const s = await setup();
    const atLimit = new Date(clock.now().getTime() + DAY_MS);
    const beyond = new Date(atLimit.getTime() + 1);

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          single(s.alice, s.bob, '100', { occurredAt: beyond.toISOString() }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          single(s.alice, s.bob, '100', { occurredAt: atLimit.toISOString() }),
        ),
      ),
    ).toBe('no error');
  });

  it('rejects a party who is not an active member with GROUP_SETTLEMENT_MEMBER_INVALID (AC-07)', async () => {
    const s = await setup();
    const other = await createGroup.execute(STRANGER, { name: 'Otro', defaultRateType: 'blue' });
    const foreign = (await groups.findMember(other.group.id, STRANGER)) as Member;
    await remove.execute(ALICE, s.groupId, s.ghost.id);

    for (const party of [foreign.id, OUTSIDER_MEMBER, s.ghost.id]) {
      const code = await codeOf(
        record.execute(ALICE, s.groupId, {
          ...single(s.alice, s.bob, '100'),
          toMemberId: party,
        }),
      );
      expect(code).toBe('GROUP_SETTLEMENT_MEMBER_INVALID');
    }
    expect(settlements.settlements).toHaveLength(0);
  });

  it('rejects the same member on both sides with GROUP_SETTLEMENT_MEMBER_INVALID (AC-07)', async () => {
    const s = await setup();

    expect(await codeOf(record.execute(ALICE, s.groupId, single(s.alice, s.alice, '100')))).toBe(
      'GROUP_SETTLEMENT_MEMBER_INVALID',
    );
  });

  it('lets a member record a payment between two others, a ghost included', async () => {
    const s = await setup();

    const saved = await record.execute(BOB, s.groupId, single(s.ghost, s.carol, '500'));

    expect(saved.createdByMemberId).toBe(s.bob.id);
    expect(saved.fromMemberId).toBe(s.ghost.id);
  });

  it('records a received settlement with the account, as no income (AC-08)', async () => {
    const s = await setup();
    const bobArs = accounts.seedAccount(BOB, 'ARS');

    const saved = await record.execute(
      BOB,
      s.groupId,
      single(s.alice, s.bob, '2500', { accountId: bobArs }),
    );

    expect(saved).toMatchObject({ accountId: bobArs, accountMemberId: s.bob.id });
    expect(recorder.movements).toHaveLength(0);
  });

  it('records a paid settlement with the account, as no expense (AC-09)', async () => {
    const s = await setup();
    const aliceArs = accounts.seedAccount(ALICE, 'ARS');

    const saved = await record.execute(
      ALICE,
      s.groupId,
      single(s.alice, s.bob, '2500', { accountId: aliceArs }),
    );

    expect(saved).toMatchObject({ accountId: aliceArs, accountMemberId: s.alice.id });
    expect(recorder.movements).toHaveLength(0);
  });

  it('rejects an account of another currency, of another user, archived, or sent by a non-party with GROUP_SETTLEMENT_ACCOUNT_INVALID (AC-10)', async () => {
    const s = await setup();
    const aliceUsd = accounts.seedAccount(ALICE, 'USD');
    const bobArs = accounts.seedAccount(BOB, 'ARS');
    const aliceArchived = accounts.seedAccount(ALICE, 'ARS', true);
    const carolArs = accounts.seedAccount(CAROL, 'ARS');
    const missing = '77777777-7777-4777-8777-777777777777';

    const attempts: [string, string][] = [
      [ALICE, aliceUsd],
      [ALICE, bobArs],
      [ALICE, aliceArchived],
      [ALICE, missing],
      [CAROL, carolArs],
    ];
    for (const [caller, accountId] of attempts) {
      expect(
        await codeOf(
          record.execute(caller, s.groupId, single(s.alice, s.bob, '100', { accountId })),
        ),
      ).toBe('GROUP_SETTLEMENT_ACCOUNT_INVALID');
    }
    expect(settlements.settlements).toHaveLength(0);
  });

  it('adds one log entry with the action, the member and the clock instant (AC-22)', async () => {
    const s = await setup();
    clock.advance(5000);

    const saved = await record.execute(BOB, s.groupId, single(s.alice, s.bob, '100'));

    const rows = expenses.activity.filter((row) => row.action === 'settlement_created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      groupId: s.groupId,
      memberId: s.bob.id,
      subjectId: saved.id,
      createdAt: clock.now(),
    });
  });

  it('leaves no settlement, leg or log row when the repository write fails (AC-05 atomicity)', async () => {
    const s = await setup();
    settlements.failAfterLegs = true;
    const logBefore = expenses.activity.length;

    const error = await errorOf(record.execute(ALICE, s.groupId, single(s.alice, s.bob, '100')));

    expect(error).toBeInstanceOf(Error);
    expect(settlements.settlements).toHaveLength(0);
    expect(expenses.activity).toHaveLength(logBefore);
    expect(sumOf(await getBalances.execute(ALICE, s.groupId), 'ARS')).toBe(0n);
  });
});

describe('RecordSettlement (consolidated)', () => {
  it('settles 100.00 USD against 50,000.00 ARS in USD at the stored rate as one 50.00 USD payment (AC-11)', async () => {
    const s = await setup();
    await crossDebts(s);
    rates.set('blue', RATE_1000);

    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }),
    );

    expect(saved).toMatchObject({
      fromMemberId: s.alice.id,
      toMemberId: s.bob.id,
      currency: 'USD',
      amount: 5000n,
      rate: RATE_1000,
      rateSource: 'automatic',
      rateType: 'blue',
    });
    expect(saved.legs).toEqual(
      expect.arrayContaining([
        { currency: 'ARS', amount: -5000000n },
        { currency: 'USD', amount: 10000n },
      ]),
    );
    const view = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(view, 'ARS', s.alice)).toBe(0n);
    expect(balanceOf(view, 'ARS', s.bob)).toBe(0n);
    expect(balanceOf(view, 'USD', s.alice)).toBe(0n);
    expect(balanceOf(view, 'USD', s.bob)).toBe(0n);
  });

  it('uses a manual rate greater than 0 and stores it with source manual (AC-12)', async () => {
    const s = await setup();
    await crossDebts(s);
    rates.set('blue', 5_000_000n);

    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }, { rate: '10000000' }),
    );

    expect(saved).toMatchObject({
      amount: 5000n,
      rate: RATE_1000,
      rateSource: 'manual',
      rateType: null,
    });
  });

  it.each(['0', '-5'])('rejects a rate of %s as invalid (AC-13)', async (rate) => {
    const s = await setup();
    await crossDebts(s);

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }, { rate }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(settlements.settlements).toHaveLength(0);
  });

  it('answers RATE_REQUIRED when no rate is stored and no manual rate is sent (error)', async () => {
    const s = await setup();
    await crossDebts(s);

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }),
        ),
      ),
    ).toBe('RATE_REQUIRED');
    expect(settlements.settlements).toHaveLength(0);
  });

  it('swaps from and to and negates the legs when the cash is negative', async () => {
    const s = await setup();
    await expense(s, s.bob, '20000', 'USD', [s.alice, s.bob]);
    await expense(s, s.alice, '40000000', 'ARS', [s.alice, s.bob]);

    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-20000000', USD: '10000' }, { rate: '10000000' }),
    );

    expect(saved).toMatchObject({ fromMemberId: s.bob.id, toMemberId: s.alice.id, amount: 10000n });
    expect(saved.legs).toEqual(
      expect.arrayContaining([
        { currency: 'ARS', amount: 20000000n },
        { currency: 'USD', amount: -10000n },
      ]),
    );
    const view = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(view, 'ARS', s.alice)).toBe(0n);
    expect(balanceOf(view, 'USD', s.bob)).toBe(0n);
  });

  it('allows a cash of 0 when both legs cancel at the rate', async () => {
    const s = await setup();
    await expense(s, s.bob, '20000', 'USD', [s.alice, s.bob]);
    await expense(s, s.alice, '20000000', 'ARS', [s.alice, s.bob]);

    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-10000000', USD: '10000' }, { rate: '10000000' }),
    );

    expect(saved.amount).toBe(0n);
    expect(saved.rateSource).toBe('manual');
    expect(settlements.hasOpenBalance(s.groupId, s.alice.id)).toBe(false);
  });

  it('records the account of the caller on a consolidated settlement', async () => {
    const s = await setup();
    await crossDebts(s);
    const aliceUsd = accounts.seedAccount(ALICE, 'USD');

    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(
        s.alice,
        s.bob,
        { ARS: '-5000000', USD: '10000' },
        { rate: '10000000', accountId: aliceUsd },
      ),
    );

    expect(saved).toMatchObject({ accountId: aliceUsd, accountMemberId: s.alice.id });
  });

  it('rejects stale legs with GROUP_SETTLEMENT_STALE (409)', async () => {
    const s = await setup();
    await crossDebts(s);
    await expense(s, s.bob, '2000', 'USD', [s.alice, s.bob]);

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }, { rate: '10000000' }),
        ),
      ),
    ).toBe('GROUP_SETTLEMENT_STALE');
    expect(settlements.settlements).toHaveLength(0);
  });

  it('rejects a pair with a missing leg with GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE', async () => {
    const s = await setup();
    await expense(s, s.bob, '20000', 'USD', [s.alice, s.bob]);

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }, { rate: '10000000' }),
        ),
      ),
    ).toBe('GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE');
  });

  it('rejects a pair that includes a non-member with GROUP_SETTLEMENT_MEMBER_INVALID (AC-07)', async () => {
    const s = await setup();
    await crossDebts(s);

    expect(
      await codeOf(
        record.execute(ALICE, s.groupId, {
          ...consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }),
          memberIds: [s.alice.id, OUTSIDER_MEMBER],
        }),
      ),
    ).toBe('GROUP_SETTLEMENT_MEMBER_INVALID');
  });

  it('consolidates only the payments between the pair, not the debts with third members', async () => {
    const s = await setup();
    await crossDebts(s);
    await expense(s, s.carol, '9000', 'ARS', [s.alice, s.carol]);
    rates.set('blue', RATE_1000);

    const view = await preview.execute(ALICE, s.groupId, {
      memberA: s.alice.id,
      memberB: s.bob.id,
      currency: 'USD',
    });

    // Bob pays Alice 4,995,500 and Carol 4,500 (the simplified plan); only the first is the pair's.
    expect(view.legs).toEqual({ ARS: -4995500n, USD: 10000n });
    await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-4995500', USD: '10000' }),
    );
    const after = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(after, 'ARS', s.carol)).toBe(4500n);
    expect(balanceOf(after, 'ARS', s.alice)).toBe(0n);
  });
});

describe('PreviewConsolidation', () => {
  it('returns the legs signed from A to B with the default rate type and its stored rate (AC-14)', async () => {
    const s = await setup();
    await crossDebts(s);
    rates.set('blue', RATE_1000);
    rates.set('oficial', 9_000_000n);

    const first = await preview.execute(ALICE, s.groupId, {
      memberA: s.alice.id,
      memberB: s.bob.id,
      currency: 'USD',
    });
    const reversed = await preview.execute(ALICE, s.groupId, {
      memberA: s.bob.id,
      memberB: s.alice.id,
      currency: 'USD',
    });

    expect(first).toEqual({
      legs: { ARS: -5000000n, USD: 10000n },
      defaultRateType: 'blue',
      rate: RATE_1000,
    });
    expect(reversed.legs).toEqual({ ARS: 5000000n, USD: -10000n });
  });

  it('offers the rate of the new default type and the stored settlements keep theirs (AC-14)', async () => {
    const s = await setup();
    await crossDebts(s);
    rates.set('blue', RATE_1000);
    rates.set('oficial', 9_000_000n);
    const saved = await record.execute(
      ALICE,
      s.groupId,
      consolidated(s.alice, s.bob, { ARS: '-5000000', USD: '10000' }),
    );

    await updateGroup.execute(ALICE, s.groupId, { defaultRateType: 'oficial' });
    const after = await preview.execute(ALICE, s.groupId, {
      memberA: s.alice.id,
      memberB: s.bob.id,
      currency: 'USD',
    });

    expect(after).toMatchObject({ defaultRateType: 'oficial', rate: 9_000_000n });
    const page = await list.execute(ALICE, s.groupId, {});
    expect(page.items[0]).toMatchObject({ id: saved.id, rateType: 'blue', rate: RATE_1000 });
  });

  it('gives a null rate when none is stored for the default type (missing rate)', async () => {
    const s = await setup();

    const view = await preview.execute(ALICE, s.groupId, {
      memberA: s.alice.id,
      memberB: s.bob.id,
      currency: 'ARS',
    });

    expect(view.rate).toBeNull();
    expect(view.legs).toEqual({ ARS: 0n, USD: 0n });
  });

  it('rejects a party who is not an active member with GROUP_SETTLEMENT_MEMBER_INVALID', async () => {
    const s = await setup();

    expect(
      await codeOf(
        preview.execute(ALICE, s.groupId, {
          memberA: s.alice.id,
          memberB: OUTSIDER_MEMBER,
          currency: 'ARS',
        }),
      ),
    ).toBe('GROUP_SETTLEMENT_MEMBER_INVALID');
  });
});

describe('ListSettlements', () => {
  it('lists newest first and pages with a cursor, each settlement once (AC-05)', async () => {
    const s = await setup();
    for (const [day, amount] of [
      [1, '100'],
      [3, '300'],
      [2, '200'],
    ] as const) {
      await record.execute(
        ALICE,
        s.groupId,
        single(s.alice, s.bob, amount, {
          occurredAt: new Date(clock.now().getTime() - (10 - day) * DAY_MS).toISOString(),
        }),
      );
    }

    const first = await list.execute(ALICE, s.groupId, { limit: 2 });
    const second = await list.execute(ALICE, s.groupId, {
      limit: 2,
      ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
    });

    expect(first.items.map((i) => i.amount)).toEqual([300n, 200n]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((i) => i.amount)).toEqual([100n]);
    expect(second.nextCursor).toBeNull();
  });

  it('shows both settlements of a ghost to the user who claims it (AC-21)', async () => {
    const s = await setup();
    await record.execute(ALICE, s.groupId, single(s.ghost, s.alice, '100'));
    await record.execute(ALICE, s.groupId, single(s.bob, s.ghost, '200'));
    const link = await createClaimLink.execute(ALICE, s.groupId, s.ghost.id);
    const dave = '44444444-4444-4444-8444-444444444444';
    await claimGhost.execute(dave, link.token);

    const page = await list.execute(dave, s.groupId, {});

    expect(page.items).toHaveLength(2);
    const claimed = (await groups.findMember(s.groupId, dave)) as Member;
    expect(claimed.id).toBe(s.ghost.id);
    expect(
      page.items.every((i) => i.fromMemberId === claimed.id || i.toMemberId === claimed.id),
    ).toBe(true);
  });
});

describe('access (404)', () => {
  it('answers 404 to a non-member on every read and write (AC-23)', async () => {
    const s = await setup();
    const calls = [
      getBalances.execute(STRANGER, s.groupId),
      record.execute(STRANGER, s.groupId, single(s.alice, s.bob, '100')),
      preview.execute(STRANGER, s.groupId, {
        memberA: s.alice.id,
        memberB: s.bob.id,
        currency: 'ARS',
      }),
      list.execute(STRANGER, s.groupId, {}),
      leave.execute(STRANGER, s.groupId),
      remove.execute(STRANGER, s.groupId, s.bob.id),
    ];

    for (const call of calls) expect(await codeOf(call)).toBe('NOT_FOUND');
  });

  it('answers 404 to a missing group (AC-23)', async () => {
    const missing = '55555555-5555-4555-8555-555555555555';

    expect(await codeOf(getBalances.execute(ALICE, missing))).toBe('NOT_FOUND');
  });

  it('answers 404 to a user who left, on reading balances or recording a settlement (AC-23)', async () => {
    const s = await setup();
    await leave.execute(CAROL, s.groupId);

    expect(await codeOf(getBalances.execute(CAROL, s.groupId))).toBe('NOT_FOUND');
    expect(await codeOf(record.execute(CAROL, s.groupId, single(s.alice, s.bob, '100')))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('RemoveMember and LeaveGroup', () => {
  it('lets an admin remove a member whose balance is 0 in ARS and USD (AC-15)', async () => {
    const s = await setup();

    await remove.execute(ALICE, s.groupId, s.carol.id);

    expect(groups.membersOf(s.groupId).map((m) => m.id)).not.toContain(s.carol.id);
    expect(groups.formerMembers.map((m) => m.id)).toEqual([s.carol.id]);
    expect(groups.leftAt.get(s.carol.id)).toEqual(clock.now());
  });

  it('drops the invitation and unused claim link of the removed member and resets a percentage split (AC-15)', async () => {
    const s = await setup();
    await createClaimLink.execute(ALICE, s.groupId, s.ghost.id);
    await createInvitation.execute(ALICE, s.groupId);
    await setDefaultSplit.execute(ALICE, s.groupId, {
      mode: 'percentage',
      shares: [
        { memberId: s.alice.id, basisPoints: 5000 },
        { memberId: s.ghost.id, basisPoints: 5000 },
      ],
    });

    await remove.execute(ALICE, s.groupId, s.ghost.id);

    expect(groups.claimLinks.filter((row) => row.memberId === s.ghost.id)).toHaveLength(0);
    expect(await expenses.getDefaultSplit(s.groupId)).toEqual({ mode: 'equal' });
  });

  it('keeps the history of a removed member (AC-15)', async () => {
    const s = await setup();
    await expense(s, s.carol, '9000', 'ARS', [s.alice, s.bob, s.carol]);
    await record.execute(ALICE, s.groupId, single(s.alice, s.carol, '3000'));
    await record.execute(ALICE, s.groupId, single(s.bob, s.carol, '3000'));
    await remove.execute(ALICE, s.groupId, s.carol.id);

    expect(expenses.expenses).toHaveLength(1);
    expect(settlements.settlements).toHaveLength(2);
    expect(sumOf(await getBalances.execute(ALICE, s.groupId), 'ARS')).toBe(0n);
  });

  it('rejects removing a member with a balance with a 409 that shows the balance (AC-16)', async () => {
    const s = await setup();
    await expense(s, s.bob, '10000', 'ARS', [s.alice, s.bob]);
    await expense(s, s.alice, '3000', 'USD', [s.alice, s.bob, s.ghost]);

    const error = await errorOf(remove.execute(ALICE, s.groupId, s.bob.id));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('GROUP_MEMBER_HAS_BALANCE');
    expect((error as AppError).details).toEqual({ ARS: '5000', USD: '-1000' });
    expect(groups.membersOf(s.groupId).map((m) => m.id)).toContain(s.bob.id);
  });

  it('rejects a member who is not an admin removing another member with 403 (AC-17)', async () => {
    const s = await setup();

    expect(await codeOf(remove.execute(BOB, s.groupId, s.carol.id))).toBe('GROUP_ADMIN_REQUIRED');
    expect(groups.formerMembers).toHaveLength(0);
  });

  it('rejects an admin removing themselves as invalid, they must leave instead', async () => {
    const s = await setup();

    expect(await codeOf(remove.execute(ALICE, s.groupId, s.alice.id))).toBe('VALIDATION_FAILED');
    expect(groups.formerMembers).toHaveLength(0);
  });

  it('answers 404 when the member to remove is not in the group', async () => {
    const s = await setup();

    expect(await codeOf(remove.execute(ALICE, s.groupId, OUTSIDER_MEMBER))).toBe('NOT_FOUND');
  });

  it('lets a member with balance 0 in every currency leave (AC-18)', async () => {
    const s = await setup();

    await leave.execute(BOB, s.groupId);

    expect(groups.membersOf(s.groupId).map((m) => m.id)).not.toContain(s.bob.id);
    expect(await codeOf(getBalances.execute(BOB, s.groupId))).toBe('NOT_FOUND');
  });

  it('lets a member who left come back with a new member row (AC-18)', async () => {
    const s = await setup();
    await leave.execute(BOB, s.groupId);
    const invitation = await createInvitation.execute(ALICE, s.groupId);

    await joinGroup.execute(BOB, invitation.token);

    const again = (await groups.findMember(s.groupId, BOB)) as Member;
    expect(again.id).not.toBe(s.bob.id);
  });

  it('rejects leaving with a balance with a 409 that shows the balance (AC-19)', async () => {
    const s = await setup();
    await expense(s, s.alice, '10000', 'ARS', [s.alice, s.bob]);

    const error = await errorOf(leave.execute(BOB, s.groupId));

    expect((error as AppError).code).toBe('GROUP_MEMBER_HAS_BALANCE');
    expect((error as AppError).details).toEqual({ ARS: '-5000', USD: '0' });
    expect(groups.membersOf(s.groupId).map((m) => m.id)).toContain(s.bob.id);
  });

  it('rejects the last admin leaving while others remain with GROUP_LAST_ADMIN (409)', async () => {
    const s = await setup();

    expect(await codeOf(leave.execute(ALICE, s.groupId))).toBe('GROUP_LAST_ADMIN');
    expect(groups.membersOf(s.groupId).map((m) => m.id)).toContain(s.alice.id);
  });

  it('lets an admin leave once another admin exists and lets the sole member leave', async () => {
    const solo = await createGroup.execute(CAROL, { name: 'Solo', defaultRateType: 'blue' });
    expect(await codeOf(leave.execute(CAROL, solo.group.id))).toBe('no error');

    const s = await setup();
    await makeAdmin.execute(ALICE, s.groupId, s.bob.id);
    expect(await codeOf(leave.execute(ALICE, s.groupId))).toBe('no error');
  });
});

/** Integer xorshift32: deterministic, and no floating point near money. */
function createRng(seed: number): (max: number) => number {
  let state = seed >>> 0;
  return (max) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % max;
  };
}

describe('random operations (NFR-02)', () => {
  it('keeps the sum of balances at 0 in each currency across 10,000 expenses, settlements, consolidations and removals', async () => {
    const s = await setup();
    const rng = createRng(20261010);
    const aliceAccounts = {
      ARS: recorder.seedAccount(ALICE, 'ARS'),
      USD: recorder.seedAccount(ALICE, 'USD'),
    };
    const aliceCategory = recorder.seedCategory(ALICE);
    for (let index = 0; index < 3; index += 1) {
      await addGhost.execute(ALICE, s.groupId, { displayName: `Extra ${index}` });
    }
    const currencies: AccountCurrency[] = ['ARS', 'USD'];
    const stats = { expenses: 0, settlements: 0, consolidations: 0, removals: 0, refused: 0 };

    const active = () => groups.membersOf(s.groupId);
    const pick = <T>(items: readonly T[]): T => items[rng(items.length)] as T;
    const assertZeroSum = async () => {
      const view = await getBalances.execute(ALICE, s.groupId);
      expect(sumOf(view, 'ARS')).toBe(0n);
      expect(sumOf(view, 'USD')).toBe(0n);
      return view;
    };

    for (let step = 0; step < 10_000; step += 1) {
      const kind = rng(100);
      const members = active();
      const currency = pick(currencies);
      if (kind < 45) {
        const payer = pick(members);
        const participants = members.filter(() => rng(2) === 0);
        if (participants.length === 0) participants.push(payer);
        await recordExpense.execute(ALICE, s.groupId, {
          amount: String(1 + rng(1_000_000)),
          currency,
          occurredAt: clock.now().toISOString(),
          payerMemberId: payer.id,
          categoryId: s.categoryId,
          description: 'Gasto',
          split: { mode: 'equal', memberIds: participants.map((m) => m.id) },
          ...(payer.id === s.alice.id
            ? { payerAccount: { accountId: aliceAccounts[currency], categoryId: aliceCategory } }
            : {}),
        });
        stats.expenses += 1;
      } else if (kind < 75) {
        const from = pick(members);
        const to = pick(members.filter((m) => m.id !== from.id));
        await record.execute(
          ALICE,
          s.groupId,
          single(from, to, String(1 + rng(500_000)), { currency }),
        );
        stats.settlements += 1;
      } else if (kind < 92) {
        const a = pick(members);
        const b = pick(members.filter((m) => m.id !== a.id));
        const view = await preview.execute(ALICE, s.groupId, {
          memberA: a.id,
          memberB: b.id,
          currency,
        });
        const request = consolidated(
          a,
          b,
          { ARS: view.legs.ARS.toString(), USD: view.legs.USD.toString() },
          { currency, ...(rng(2) === 0 ? { rate: String(500_000 + rng(20_000_000)) } : {}) },
        );
        if (view.legs.ARS === 0n || view.legs.USD === 0n) {
          expect(await codeOf(record.execute(ALICE, s.groupId, request))).toBe(
            'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE',
          );
          stats.refused += 1;
        } else {
          if (request.rate === undefined) rates.set('blue', BigInt(500_000 + rng(20_000_000)));
          await record.execute(ALICE, s.groupId, request);
          stats.consolidations += 1;
        }
      } else {
        const target = pick(members.filter((m) => m.id !== s.alice.id));
        if (rng(10) < 7) {
          const view = await getBalances.execute(ALICE, s.groupId);
          for (const cur of currencies) {
            const balance = balanceOf(view, cur, target);
            if (balance > 0n) {
              await record.execute(
                ALICE,
                s.groupId,
                single(s.alice, target, balance.toString(), { currency: cur }),
              );
            } else if (balance < 0n) {
              await record.execute(
                ALICE,
                s.groupId,
                single(target, s.alice, (-balance).toString(), { currency: cur }),
              );
            }
          }
        }
        const code = await codeOf(remove.execute(ALICE, s.groupId, target.id));
        if (code === 'no error') {
          stats.removals += 1;
          await addGhost.execute(ALICE, s.groupId, { displayName: `Nuevo ${step}` });
        } else {
          expect(code).toBe('GROUP_MEMBER_HAS_BALANCE');
          stats.refused += 1;
        }
      }
      await assertZeroSum();
    }

    expect(stats.expenses).toBeGreaterThan(3000);
    expect(stats.settlements).toBeGreaterThan(2000);
    expect(stats.consolidations).toBeGreaterThan(50);
    expect(stats.removals).toBeGreaterThan(100);
    expect(settlements.sumsToZero(s.groupId)).toBe(true);
    for (const former of groups.formerMembers) {
      expect(settlements.hasOpenBalance(s.groupId, former.id)).toBe(false);
    }
  }, 30_000);
});
