import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, type CreateGroupExpenseRequest } from '@pesly/shared';
import {
  AddGhostMember,
  ClaimGhostMember,
  CreateClaimLink,
  CreateGroup,
  CreateGroupCategory,
  CreateInvitation,
  GetExpenseOptions,
  GetGroupExpense,
  JoinGroup,
  ListGroupExpenses,
  ListPersonalShares,
  RecordGroupExpense,
  SetDefaultSplit,
  UpdateGroupCategory,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { DeterministicTokenSource, FakeClock, InMemoryGroupRepository } from './fakes';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const OUTSIDER_MEMBER = '88888888-8888-4888-8888-888888888888';
const DAY_MS = 24 * 60 * 60 * 1000;

let clock: FakeClock;
let tokens: DeterministicTokenSource;
let groups: InMemoryGroupRepository;
let recorder: InMemoryPayerMovementRecorder;
let expenses: InMemoryGroupExpenseRepository;
let createGroup: CreateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let addGhost: AddGhostMember;
let createClaimLink: CreateClaimLink;
let claimGhost: ClaimGhostMember;
let createCategory: CreateGroupCategory;
let updateCategory: UpdateGroupCategory;
let record: RecordGroupExpense;
let list: ListGroupExpenses;
let get: GetGroupExpense;
let options: GetExpenseOptions;
let setDefaultSplit: SetDefaultSplit;
let personal: ListPersonalShares;

beforeEach(() => {
  clock = new FakeClock();
  tokens = new DeterministicTokenSource();
  groups = new InMemoryGroupRepository(clock);
  recorder = new InMemoryPayerMovementRecorder();
  expenses = new InMemoryGroupExpenseRepository(groups, recorder);
  const deps = { groups, clock, tokens, expenses, payerMovements: recorder };
  createGroup = new CreateGroup(deps);
  createInvitation = new CreateInvitation(deps);
  joinGroup = new JoinGroup(deps);
  addGhost = new AddGhostMember(deps);
  createClaimLink = new CreateClaimLink(deps);
  claimGhost = new ClaimGhostMember(deps);
  createCategory = new CreateGroupCategory(deps);
  updateCategory = new UpdateGroupCategory(deps);
  record = new RecordGroupExpense(deps);
  list = new ListGroupExpenses(deps);
  get = new GetGroupExpense(deps);
  options = new GetExpenseOptions(deps);
  setDefaultSplit = new SetDefaultSplit(deps);
  personal = new ListPersonalShares(deps);
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'no error';
}

async function detailsOf(promise: Promise<unknown>): Promise<Record<string, string> | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.details;
    throw error;
  }
  return undefined;
}

interface Setup {
  groupId: string;
  alice: Member;
  bob: Member;
  ghost: Member;
  categoryId: string;
  aliceArs: string;
  aliceCategory: string;
}

/** Alice (admin), Bob and a ghost "Pedro". */
async function setup(): Promise<Setup> {
  const created = await createGroup.execute(ALICE, { name: 'Casa', defaultRateType: 'blue' });
  const groupId = created.group.id;
  const invitation = await createInvitation.execute(ALICE, groupId);
  await joinGroup.execute(BOB, invitation.token);
  clock.advance(1000);
  const ghost = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
  const alice = (await groups.findMember(groupId, ALICE)) as Member;
  const bob = (await groups.findMember(groupId, BOB)) as Member;
  const [category] = await groups.listCategories(groupId);
  return {
    groupId,
    alice,
    bob,
    ghost,
    categoryId: (category as { id: string }).id,
    aliceArs: recorder.seedAccount(ALICE, 'ARS'),
    aliceCategory: recorder.seedCategory(ALICE),
  };
}

function request(
  s: Setup,
  overrides: Partial<CreateGroupExpenseRequest> = {},
): CreateGroupExpenseRequest {
  return {
    amount: '4000000',
    currency: 'ARS',
    occurredAt: clock.now().toISOString(),
    payerMemberId: s.bob.id,
    categoryId: s.categoryId,
    description: 'Cena',
    split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id] },
    ...overrides,
  };
}

describe('RecordGroupExpense', () => {
  it('stores the expense with shares that add up to the amount (AC-01)', async () => {
    const s = await setup();

    const expense = await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '10000',
        split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id, s.ghost.id] },
      }),
    );

    expect(expenses.expenses).toHaveLength(1);
    expect(expense).toMatchObject({
      groupId: s.groupId,
      amount: 10000n,
      currency: 'ARS',
      splitMode: 'equal',
      createdByMemberId: s.alice.id,
      payerMovementId: null,
    });
    expect(expense.shares.reduce((total, share) => total + share.amount, 0n)).toBe(10000n);
    expect(expense.shares).toHaveLength(3);
  });

  it('gives the leftover unit to the payer first, then by joining order (FR-06)', async () => {
    const s = await setup();

    const expense = await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '10000',
        payerMemberId: s.ghost.id,
        split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id, s.ghost.id] },
      }),
    );

    const byMember = new Map(expense.shares.map((share) => [share.memberId, share.amount]));
    expect(byMember.get(s.ghost.id)).toBe(3334n);
    expect(byMember.get(s.alice.id)).toBe(3333n);
    expect(byMember.get(s.bob.id)).toBe(3333n);
  });

  describe('leftover order when the payer is not in the split (AC-13)', () => {
    async function threeNonPayers(s: Setup): Promise<{ early: Member; mid: Member; late: Member }> {
      const marta = await extraMember(s);
      const members = groups.membersOf(s.groupId);
      const find = (id: string) => members.find((m) => m.id === id) as Member;
      return { early: find(marta.id), mid: find(s.ghost.id), late: find(s.bob.id) };
    }

    it('gives the 0.01 leftover of 100.00 ARS to the earliest joinedAt, whatever the insertion order', async () => {
      const s = await setup();
      const { early, mid, late } = await threeNonPayers(s);
      const base = clock.now().getTime();
      // Insertion order in the repository is bob, ghost, marta: the opposite of the joining order.
      late.joinedAt = new Date(base + 3000);
      mid.joinedAt = new Date(base + 2000);
      early.joinedAt = new Date(base + 1000);

      const expense = await record.execute(
        ALICE,
        s.groupId,
        request(s, {
          amount: '10000',
          payerMemberId: s.alice.id,
          payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
          split: { mode: 'equal', memberIds: [late.id, mid.id, early.id] },
        }),
      );

      const byMember = new Map(expense.shares.map((share) => [share.memberId, share.amount]));
      expect(expense.shares).toHaveLength(3);
      expect(byMember.get(early.id)).toBe(3334n);
      expect(byMember.get(mid.id)).toBe(3333n);
      expect(byMember.get(late.id)).toBe(3333n);
      expect(byMember.has(s.alice.id)).toBe(false);
    });

    it('breaks a joinedAt tie by member id', async () => {
      const s = await setup();
      const { early, mid, late } = await threeNonPayers(s);
      const sameInstant = new Date(clock.now().getTime() + 1000);
      for (const member of [early, mid, late]) member.joinedAt = sameInstant;
      const lowest = [early, mid, late].map((m) => m.id).sort()[0];

      const expense = await record.execute(
        ALICE,
        s.groupId,
        request(s, {
          amount: '10000',
          payerMemberId: s.alice.id,
          payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
          split: { mode: 'equal', memberIds: [late.id, mid.id, early.id] },
        }),
      );

      const bigger = expense.shares.filter((share) => share.amount === 3334n);
      expect(bigger.map((share) => share.memberId)).toEqual([lowest]);
    });
  });

  it('stores basis points on a percentage split and the amounts as given on an exact one (AC-08, AC-10)', async () => {
    const s = await setup();

    const percentage = await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '10000000',
        split: {
          mode: 'percentage',
          shares: [
            { memberId: s.alice.id, basisPoints: 6000 },
            { memberId: s.bob.id, basisPoints: 4000 },
          ],
        },
      }),
    );
    const exact = await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '100',
        split: {
          mode: 'exact',
          shares: [
            { memberId: s.alice.id, amount: '70' },
            { memberId: s.bob.id, amount: '30' },
          ],
        },
      }),
    );

    expect(percentage.shares).toContainEqual({
      memberId: s.alice.id,
      amount: 6000000n,
      basisPoints: 6000,
    });
    expect(percentage.shares).toContainEqual({
      memberId: s.bob.id,
      amount: 4000000n,
      basisPoints: 4000,
    });
    expect(exact.shares).toContainEqual({ memberId: s.alice.id, amount: 70n, basisPoints: null });
  });

  it.each(['0', '-1'])('rejects an amount of %s as invalid (AC-02)', async (amount) => {
    const s = await setup();

    expect(await codeOf(record.execute(ALICE, s.groupId, request(s, { amount })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(expenses.expenses).toHaveLength(0);
  });

  it('rejects a date more than 1 day ahead and accepts exactly 1 day (D13)', async () => {
    const s = await setup();
    const atLimit = new Date(clock.now().getTime() + DAY_MS);
    const beyond = new Date(atLimit.getTime() + 1);

    expect(
      await codeOf(
        record.execute(ALICE, s.groupId, request(s, { occurredAt: beyond.toISOString() })),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        record.execute(ALICE, s.groupId, request(s, { occurredAt: atLimit.toISOString() })),
      ),
    ).toBe('no error');
  });

  it('rejects a split containing someone who is not a member of the group (AC-03)', async () => {
    const s = await setup();
    const other = await createGroup.execute(CAROL, { name: 'Otro', defaultRateType: 'blue' });
    const carol = (await groups.findMember(other.group.id, CAROL)) as Member;

    for (const memberId of [carol.id, OUTSIDER_MEMBER]) {
      const code = await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          request(s, { split: { mode: 'equal', memberIds: [s.alice.id, memberId] } }),
        ),
      );
      expect(code).toBe('GROUP_SPLIT_MEMBER_INVALID');
    }
    expect(expenses.expenses).toHaveLength(0);
  });

  it('rejects a payer who is not a member of the group (assumption)', async () => {
    const s = await setup();

    expect(
      await codeOf(
        record.execute(ALICE, s.groupId, request(s, { payerMemberId: OUTSIDER_MEMBER })),
      ),
    ).toBe('GROUP_SPLIT_MEMBER_INVALID');
  });

  it('rejects a category of another group and an archived one (AC-04)', async () => {
    const s = await setup();
    const other = await createGroup.execute(CAROL, { name: 'Otro', defaultRateType: 'blue' });
    const [foreign] = await groups.listCategories(other.group.id);
    await updateCategory.execute(ALICE, s.groupId, s.categoryId, { archived: true });

    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          request(s, { categoryId: (foreign as { id: string }).id }),
        ),
      ),
    ).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
    expect(await codeOf(record.execute(ALICE, s.groupId, request(s)))).toBe(
      'GROUP_EXPENSE_CATEGORY_INVALID',
    );
    expect(expenses.expenses).toHaveLength(0);
  });

  it('rejects a percentage split not adding up to 100% and reports the total (AC-09)', async () => {
    const s = await setup();
    const call = record.execute(
      ALICE,
      s.groupId,
      request(s, {
        split: {
          mode: 'percentage',
          shares: [
            { memberId: s.alice.id, basisPoints: 5000 },
            { memberId: s.bob.id, basisPoints: 4999 },
          ],
        },
      }),
    );

    expect(await detailsOf(call)).toEqual({ total: '9999' });
    expect(
      await codeOf(
        record.execute(
          ALICE,
          s.groupId,
          request(s, {
            split: {
              mode: 'percentage',
              shares: [{ memberId: s.alice.id, basisPoints: 9999 }],
            },
          }),
        ),
      ),
    ).toBe('GROUP_SPLIT_PERCENTAGE_INVALID');
  });

  it('rejects an exact split not adding up and reports the signed difference (AC-11)', async () => {
    const s = await setup();
    const short = request(s, {
      amount: '100',
      split: {
        mode: 'exact',
        shares: [
          { memberId: s.alice.id, amount: '60' },
          { memberId: s.bob.id, amount: '30' },
        ],
      },
    });
    const over = request(s, {
      amount: '100',
      split: {
        mode: 'exact',
        shares: [
          { memberId: s.alice.id, amount: '60' },
          { memberId: s.bob.id, amount: '50' },
        ],
      },
    });

    expect(await detailsOf(record.execute(ALICE, s.groupId, short))).toEqual({ difference: '10' });
    expect(await detailsOf(record.execute(ALICE, s.groupId, over))).toEqual({ difference: '-10' });
    expect(await codeOf(record.execute(ALICE, s.groupId, short))).toBe(
      'GROUP_SPLIT_AMOUNT_MISMATCH',
    );
  });

  it('records one movement of the full amount when the caller pays from an ARS account (AC-14)', async () => {
    const s = await setup();

    const expense = await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        payerMemberId: s.alice.id,
        split: {
          mode: 'equal',
          memberIds: [s.alice.id, s.bob.id, s.ghost.id],
        },
        payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
      }),
    );

    expect(recorder.movements).toHaveLength(1);
    expect(recorder.movements[0]).toMatchObject({
      userId: ALICE,
      accountId: s.aliceArs,
      categoryId: s.aliceCategory,
      amount: 4000000n,
      note: 'Cena',
      rateType: 'blue',
    });
    expect(expense.payerMovementId).toBe(recorder.movements[0]?.id);
    expect(recorder.spentOn(s.aliceArs)).toBe(4000000n);
  });

  it('rejects an account of another currency, of another user or of a missing one (AC-15)', async () => {
    const s = await setup();
    const usd = recorder.seedAccount(ALICE, 'USD');
    const bobs = recorder.seedAccount(BOB, 'ARS');
    const bobsCategory = recorder.seedCategory(BOB);
    const incomeCategory = recorder.seedCategory(ALICE, 'income');
    const attempts = [
      { accountId: usd, categoryId: s.aliceCategory },
      { accountId: bobs, categoryId: s.aliceCategory },
      { accountId: s.aliceArs, categoryId: bobsCategory },
      { accountId: s.aliceArs, categoryId: incomeCategory },
      { accountId: OUTSIDER_MEMBER, categoryId: s.aliceCategory },
    ];

    for (const payerAccount of attempts) {
      const code = await codeOf(
        record.execute(ALICE, s.groupId, request(s, { payerMemberId: s.alice.id, payerAccount })),
      );
      expect(code).toBe('GROUP_PAYER_ACCOUNT_INVALID');
    }
    expect(expenses.expenses).toHaveLength(0);
    expect(recorder.movements).toHaveLength(0);
  });

  it('rejects a missing payer account when the caller pays (AC-15)', async () => {
    const s = await setup();

    expect(
      await codeOf(record.execute(ALICE, s.groupId, request(s, { payerMemberId: s.alice.id }))),
    ).toBe('GROUP_PAYER_ACCOUNT_INVALID');
  });

  it('rejects a payer account sent for another payer (AC-15)', async () => {
    const s = await setup();

    const code = await codeOf(
      record.execute(
        ALICE,
        s.groupId,
        request(s, {
          payerMemberId: s.bob.id,
          payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
        }),
      ),
    );

    expect(code).toBe('GROUP_PAYER_ACCOUNT_INVALID');
    expect(expenses.expenses).toHaveLength(0);
  });

  it('records the expense and no movement for a ghost payer or another registered payer (AC-16, AC-18)', async () => {
    const s = await setup();

    const byGhost = await record.execute(
      ALICE,
      s.groupId,
      request(s, { payerMemberId: s.ghost.id }),
    );
    const byBob = await record.execute(ALICE, s.groupId, request(s));

    expect(byGhost.payerMovementId).toBeNull();
    expect(byBob.payerMovementId).toBeNull();
    expect(expenses.expenses).toHaveLength(2);
    expect(recorder.movements).toHaveLength(0);
  });

  it('adds one log entry with the action, the member and the instant of the clock (AC-22)', async () => {
    const s = await setup();

    const expense = await record.execute(ALICE, s.groupId, request(s));

    expect(expenses.activity).toHaveLength(1);
    expect(expenses.activity[0]).toMatchObject({
      groupId: s.groupId,
      memberId: s.alice.id,
      action: 'expense_created',
      subjectId: expense.id,
      createdAt: clock.now(),
    });
  });

  it('leaves no expense, share, log row or movement when the repository write fails (AC-01)', async () => {
    const s = await setup();
    expenses.failAfterMovement = true;

    await expect(
      record.execute(
        ALICE,
        s.groupId,
        request(s, {
          payerMemberId: s.alice.id,
          payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
        }),
      ),
    ).rejects.toThrow('forced failure');

    expect(expenses.expenses).toHaveLength(0);
    expect(expenses.activity).toHaveLength(0);
    expect(recorder.movements).toHaveLength(0);
  });

  it('answers 404 to a non-member and to a missing group (AC-23)', async () => {
    const s = await setup();

    await expect(record.execute(STRANGER, s.groupId, request(s))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(record.execute(ALICE, OUTSIDER_MEMBER, request(s))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('reading expenses', () => {
  it('lists newest first with a cursor and answers 404 to a non-member (AC-23)', async () => {
    const s = await setup();
    for (const [index, day] of [1, 2, 3].entries()) {
      await record.execute(
        ALICE,
        s.groupId,
        request(s, {
          description: `Gasto ${index}`,
          occurredAt: new Date(clock.now().getTime() - day * DAY_MS).toISOString(),
        }),
      );
    }

    const first = await list.execute(BOB, s.groupId, { limit: 2 });
    const second = await list.execute(BOB, s.groupId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.items.map((e) => e.description)).toEqual(['Gasto 0', 'Gasto 1']);
    expect(second.items.map((e) => e.description)).toEqual(['Gasto 2']);
    expect(second.nextCursor).toBeNull();
    await expect(list.execute(STRANGER, s.groupId, {})).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('gets one expense, and an expense of another group, a missing one or a non-member is the same 404 (AC-23)', async () => {
    const s = await setup();
    const expense = await record.execute(ALICE, s.groupId, request(s));
    const other = await createGroup.execute(CAROL, { name: 'Otro', defaultRateType: 'blue' });

    expect((await get.execute(BOB, s.groupId, expense.id)).id).toBe(expense.id);
    await expect(get.execute(CAROL, other.group.id, expense.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(get.execute(BOB, s.groupId, OUTSIDER_MEMBER)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(get.execute(STRANGER, s.groupId, expense.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('default split and options', () => {
  it('returns the 60% / 40% default split in the options for prefill (AC-05)', async () => {
    const s = await setup();
    await setDefaultSplit.execute(ALICE, s.groupId, {
      mode: 'percentage',
      shares: [
        { memberId: s.alice.id, basisPoints: 6000 },
        { memberId: s.bob.id, basisPoints: 4000 },
      ],
    });

    const result = await options.execute(BOB, s.groupId);

    expect(result.defaultSplit).toEqual({
      mode: 'percentage',
      shares: [
        { memberId: s.alice.id, basisPoints: 6000 },
        { memberId: s.bob.id, basisPoints: 4000 },
      ],
    });
    expect(result.defaultRateType).toBe('blue');
    expect(result.members.map((m) => m.id)).toEqual([s.alice.id, s.bob.id, s.ghost.id]);
  });

  it('defaults to an equal split and "equal" replaces a stored percentage one (D8)', async () => {
    const s = await setup();
    expect((await options.execute(ALICE, s.groupId)).defaultSplit).toEqual({ mode: 'equal' });
    await setDefaultSplit.execute(ALICE, s.groupId, {
      mode: 'percentage',
      shares: [{ memberId: s.alice.id, basisPoints: 10000 }],
    });

    await setDefaultSplit.execute(ALICE, s.groupId, { mode: 'equal' });

    expect((await options.execute(ALICE, s.groupId)).defaultSplit).toEqual({ mode: 'equal' });
  });

  it('answers GROUP_ADMIN_REQUIRED to a member who is not an admin (AC-06)', async () => {
    const s = await setup();

    expect(await codeOf(setDefaultSplit.execute(BOB, s.groupId, { mode: 'equal' }))).toBe(
      'GROUP_ADMIN_REQUIRED',
    );
    await expect(
      setDefaultSplit.execute(STRANGER, s.groupId, { mode: 'equal' }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(expenses.defaultSplits.size).toBe(0);
  });

  it('validates the default split like an expense split (D8)', async () => {
    const s = await setup();

    expect(
      await detailsOf(
        setDefaultSplit.execute(ALICE, s.groupId, {
          mode: 'percentage',
          shares: [
            { memberId: s.alice.id, basisPoints: 6000 },
            { memberId: s.bob.id, basisPoints: 3000 },
          ],
        }),
      ),
    ).toEqual({ total: '9000' });
    expect(
      await codeOf(
        setDefaultSplit.execute(ALICE, s.groupId, {
          mode: 'percentage',
          shares: [
            { memberId: s.alice.id, basisPoints: 5000 },
            { memberId: OUTSIDER_MEMBER, basisPoints: 5000 },
          ],
        }),
      ),
    ).toBe('GROUP_SPLIT_MEMBER_INVALID');
  });

  it('does not offer an archived category and offers a new one (AC-19, AC-20)', async () => {
    const s = await setup();
    await updateCategory.execute(ALICE, s.groupId, s.categoryId, { archived: true });
    const created = await createCategory.execute(ALICE, s.groupId, {
      name: 'Mascotas',
      icon: 'paw-print',
      color: 'orange',
    });

    const result = await options.execute(BOB, s.groupId);

    expect(result.categories.map((c) => c.id)).not.toContain(s.categoryId);
    expect(result.categories.map((c) => c.id)).toContain(created.id);
    await expect(options.execute(STRANGER, s.groupId)).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('ListPersonalShares', () => {
  it('shows the payer a share of 10,000.00 and a receivable of 30,000.00 (AC-17)', async () => {
    const s = await setup();
    await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        payerMemberId: s.alice.id,
        split: {
          mode: 'equal',
          memberIds: [s.alice.id, s.bob.id, s.ghost.id, (await extraMember(s)).id],
        },
        payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
      }),
    );

    const view = await personal.execute(ALICE, {});

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      groupId: s.groupId,
      currency: 'ARS',
      shareAmount: 1000000n,
      receivableAmount: 3000000n,
    });
  });

  it("shows another member's 10,000.00 share with no receivable and records no movement (AC-18)", async () => {
    const s = await setup();
    await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        payerMemberId: s.alice.id,
        amount: '2000000',
        split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id] },
        payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
      }),
    );
    const movementsBefore = recorder.movements.length;

    const view = await personal.execute(BOB, {});

    expect(view.items[0]).toMatchObject({ shareAmount: 1000000n, receivableAmount: null });
    expect(recorder.movements).toHaveLength(movementsBefore);
  });

  it('keeps data of other groups out and filters by period', async () => {
    const s = await setup();
    const old = new Date(clock.now().getTime() - 10 * DAY_MS);
    await record.execute(ALICE, s.groupId, request(s, { occurredAt: old.toISOString() }));
    await record.execute(ALICE, s.groupId, request(s));
    const other = await createGroup.execute(CAROL, { name: 'Otro', defaultRateType: 'blue' });
    const carol = (await groups.findMember(other.group.id, CAROL)) as Member;
    const [carolCategory] = await groups.listCategories(other.group.id);
    await record.execute(CAROL, other.group.id, {
      ...request(s),
      payerMemberId: carol.id,
      categoryId: (carolCategory as { id: string }).id,
      split: { mode: 'equal', memberIds: [carol.id] },
      payerAccount: {
        accountId: recorder.seedAccount(CAROL, 'ARS'),
        categoryId: recorder.seedCategory(CAROL),
      },
    });

    const all = await personal.execute(BOB, {});
    const recent = await personal.execute(BOB, { from: new Date(clock.now().getTime() - DAY_MS) });

    expect(all.items).toHaveLength(2);
    expect(all.items.every((item) => item.groupId === s.groupId)).toBe(true);
    expect(recent.items).toHaveLength(1);
  });

  it("follows a claimed ghost: the claiming user's view shows the ghost's expenses (AC-21)", async () => {
    const s = await setup();
    await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '1000',
        payerMemberId: s.ghost.id,
        split: { mode: 'equal', memberIds: [s.ghost.id, s.alice.id] },
      }),
    );
    await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '800',
        payerMemberId: s.ghost.id,
        split: { mode: 'equal', memberIds: [s.ghost.id, s.bob.id] },
      }),
    );
    await record.execute(
      ALICE,
      s.groupId,
      request(s, {
        amount: '600',
        payerMemberId: s.alice.id,
        split: { mode: 'exact', shares: [{ memberId: s.ghost.id, amount: '600' }] },
        payerAccount: { accountId: s.aliceArs, categoryId: s.aliceCategory },
      }),
    );
    expect((await personal.execute(CAROL, {})).items).toHaveLength(0);

    const link = await createClaimLink.execute(ALICE, s.groupId, s.ghost.id);
    await claimGhost.execute(CAROL, link.token);
    const view = await personal.execute(CAROL, {});

    const byAmount = (amount: bigint) =>
      expenses.expenses.find((e) => e.amount === amount)?.id as string;
    const summary = view.items
      .map((item) => ({
        expenseId: item.expenseId,
        shareAmount: item.shareAmount,
        receivableAmount: item.receivableAmount,
      }))
      .sort((a, b) => Number(a.shareAmount - b.shareAmount));
    expect(summary).toEqual([
      { expenseId: byAmount(800n), shareAmount: 400n, receivableAmount: 400n },
      { expenseId: byAmount(1000n), shareAmount: 500n, receivableAmount: 500n },
      { expenseId: byAmount(600n), shareAmount: 600n, receivableAmount: null },
    ]);
    expect(expenses.expenses.filter((e) => e.payerMemberId === s.ghost.id)).toHaveLength(2);
    expect(
      expenses.expenses.flatMap((e) => e.shares).filter((share) => share.memberId === s.ghost.id),
    ).toHaveLength(3);
  });

  it('paginates with a cursor, each expense once', async () => {
    const s = await setup();
    for (const day of [1, 2, 3]) {
      await record.execute(
        ALICE,
        s.groupId,
        request(s, { occurredAt: new Date(clock.now().getTime() - day * DAY_MS).toISOString() }),
      );
    }

    const first = await personal.execute(BOB, { limit: 2 });
    const second = await personal.execute(BOB, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    const ids = [...first.items, ...second.items].map((item) => item.expenseId);
    expect(new Set(ids).size).toBe(3);
    expect(second.nextCursor).toBeNull();
  });
});

async function extraMember(s: Setup): Promise<Member> {
  return addGhost.execute(ALICE, s.groupId, { displayName: 'Marta' });
}
