import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  expenseSnapshotSchema,
  settlementSnapshotSchema,
  type AccountCurrency,
  type CreateGroupExpenseRequest,
  type UpdateGroupExpenseRequest,
} from '@pesly/shared';
import {
  AddGhostMember,
  CreateGroup,
  CreateInvitation,
  DeleteGroupExpense,
  DeleteSettlement,
  expenseSnapshot,
  GetBalances,
  GroupRecordFormerMember,
  JoinGroup,
  LeaveGroup,
  ListActivity,
  PreviewConsolidation,
  RecordGroupExpense,
  RecordSettlement,
  settlementSnapshot,
  UpdateGroupExpense,
  UpdateSettlement,
  type GroupBalances,
  type GroupExpense,
  type GroupSettlement,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { InMemoryActivityLogReader } from './change-fakes';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';
import { DeterministicTokenSource, FakeClock } from './fakes';
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
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_1000 = 10_000_000n;

let clock: FakeClock;
let groups: InMemoryMembershipGroupRepository;
let recorder: InMemoryPayerMovementRecorder;
let expenses: InMemoryGroupExpenseRepository;
let settlements: InMemoryGroupSettlementRepository;
let rates: InMemoryRateReader;
let createGroup: CreateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let addGhost: AddGhostMember;
let leave: LeaveGroup;
let recordExpense: RecordGroupExpense;
let recordSettlement: RecordSettlement;
let getBalances: GetBalances;
let preview: PreviewConsolidation;
let updateExpense: UpdateGroupExpense;
let deleteExpense: DeleteGroupExpense;
let updateSettlement: UpdateSettlement;
let deleteSettlement: DeleteSettlement;
let listActivity: ListActivity;

beforeEach(() => {
  clock = new FakeClock();
  groups = new InMemoryMembershipGroupRepository(clock);
  recorder = new InMemoryPayerMovementRecorder();
  expenses = new InMemoryGroupExpenseRepository(groups, recorder);
  settlements = new InMemoryGroupSettlementRepository(groups, expenses);
  rates = new InMemoryRateReader();
  const deps = {
    groups,
    clock,
    tokens: new DeterministicTokenSource(),
    expenses,
    payerMovements: recorder,
    settlements,
    accounts: new InMemorySettlementAccountChecker(),
    rates,
    activity: new InMemoryActivityLogReader(expenses),
  };
  createGroup = new CreateGroup(deps);
  createInvitation = new CreateInvitation(deps);
  joinGroup = new JoinGroup(deps);
  addGhost = new AddGhostMember(deps);
  leave = new LeaveGroup(deps);
  recordExpense = new RecordGroupExpense(deps);
  recordSettlement = new RecordSettlement(deps);
  getBalances = new GetBalances(deps);
  preview = new PreviewConsolidation(deps);
  updateExpense = new UpdateGroupExpense(deps);
  deleteExpense = new DeleteGroupExpense(deps);
  updateSettlement = new UpdateSettlement(deps);
  deleteSettlement = new DeleteSettlement(deps);
  listActivity = new ListActivity(deps);
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

/**
 * `payer` (Bob by default) pays `amount` split equally among `splitWith`; recorded by `userId`
 * (Bob by default). The caller who pays must name an account, so a payer movement is attached
 * whenever the recorder is the payer; record it as someone else to get no movement.
 */
async function newExpense(
  s: Setup,
  amount: string,
  options: {
    userId?: string;
    payer?: Member;
    currency?: AccountCurrency;
    splitWith?: Member[];
  } = {},
): Promise<GroupExpense> {
  const payer = options.payer ?? s.bob;
  const recordedBy = options.userId ?? BOB;
  const request: CreateGroupExpenseRequest = {
    amount,
    currency: options.currency ?? 'ARS',
    occurredAt: clock.now().toISOString(),
    payerMemberId: payer.id,
    categoryId: s.categoryId,
    description: 'Cena',
    split: { mode: 'equal', memberIds: (options.splitWith ?? [s.alice, s.bob]).map((m) => m.id) },
    ...(payer.userId === recordedBy
      ? {
          payerAccount: {
            accountId: recorder.seedAccount(payer.userId, options.currency ?? 'ARS'),
            categoryId: recorder.seedCategory(payer.userId),
          },
        }
      : {}),
  };
  return recordExpense.execute(recordedBy, s.groupId, request);
}

function edit(
  s: Setup,
  overrides: Partial<UpdateGroupExpenseRequest> = {},
): UpdateGroupExpenseRequest {
  return {
    amount: '6000000',
    occurredAt: clock.now().toISOString(),
    categoryId: s.categoryId,
    description: 'Cena editada',
    split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id] },
    ...overrides,
  };
}

async function newSettlement(
  s: Setup,
  from: Member,
  to: Member,
  amount: string,
  userId = CAROL,
  currency: AccountCurrency = 'ARS',
): Promise<GroupSettlement> {
  return recordSettlement.execute(userId, s.groupId, {
    kind: 'single',
    fromMemberId: from.id,
    toMemberId: to.id,
    currency,
    amount,
    occurredAt: clock.now().toISOString(),
  });
}

function balanceOf(view: GroupBalances, currency: AccountCurrency, member: Member): bigint {
  return view[currency].members.find((m) => m.memberId === member.id)?.balance ?? 0n;
}

describe('change permission (D1)', () => {
  it('lets the member who recorded an expense edit it and delete it (AC-01)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');

    const updated = await updateExpense.execute(BOB, s.groupId, saved.id, edit(s));
    expect(updated.amount).toBe(6000000n);
    expect(updated.description).toBe('Cena editada');
    expect(expenses.expenses).toHaveLength(1);

    await deleteExpense.execute(BOB, s.groupId, saved.id);
    expect(expenses.expenses).toHaveLength(0);
  });

  it('lets an admin who did not record a settlement edit it and delete it (AC-02)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', CAROL);

    const updated = await updateSettlement.execute(ALICE, s.groupId, saved.id, {
      amount: '1500000',
    });
    expect(updated.amount).toBe(1500000n);
    expect(updated.legs).toEqual([{ currency: 'ARS', amount: 1500000n }]);

    await deleteSettlement.execute(ALICE, s.groupId, saved.id);
    expect(settlements.settlements).toHaveLength(0);
  });

  it('answers 403 to a member who is not the author or an admin and leaves the expense unchanged (AC-03)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    const before = structuredClone(expenses.expenses);
    const logBefore = expenses.activity.length;

    expect(await codeOf(updateExpense.execute(CAROL, s.groupId, saved.id, edit(s)))).toBe(
      'GROUP_RECORD_EDIT_FORBIDDEN',
    );
    expect(await codeOf(deleteExpense.execute(CAROL, s.groupId, saved.id))).toBe(
      'GROUP_RECORD_EDIT_FORBIDDEN',
    );

    expect(expenses.expenses).toEqual(before);
    expect(expenses.activity).toHaveLength(logBefore);
  });

  it('answers 403 to a member who is not the author or an admin and leaves the settlement unchanged (AC-04)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    const before = structuredClone(settlements.settlements);
    const logBefore = expenses.activity.length;

    expect(await codeOf(updateSettlement.execute(BOB, s.groupId, saved.id, { amount: '5' }))).toBe(
      'GROUP_RECORD_EDIT_FORBIDDEN',
    );
    expect(await codeOf(deleteSettlement.execute(BOB, s.groupId, saved.id))).toBe(
      'GROUP_RECORD_EDIT_FORBIDDEN',
    );

    expect(settlements.settlements).toEqual(before);
    expect(expenses.activity).toHaveLength(logBefore);
  });

  it('lets only an admin change a record whose author is not an active member (403 for the others)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000', { userId: ALICE, payer: s.alice });
    // A record whose author id matches no caller: only an admin gets through.
    expenses.expenses[0] = { ...saved, createdByMemberId: s.ghost.id };

    expect(await codeOf(updateExpense.execute(BOB, s.groupId, saved.id, edit(s)))).toBe(
      'GROUP_RECORD_EDIT_FORBIDDEN',
    );
    await updateExpense.execute(ALICE, s.groupId, saved.id, edit(s));
  });
});

describe('access order (AC-12)', () => {
  it('answers 404 to a non-member on every operation', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    const settlement = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    for (const userId of [STRANGER]) {
      expect(await codeOf(updateExpense.execute(userId, s.groupId, saved.id, edit(s)))).toBe(
        'NOT_FOUND',
      );
      expect(await codeOf(deleteExpense.execute(userId, s.groupId, saved.id))).toBe('NOT_FOUND');
      expect(
        await codeOf(updateSettlement.execute(userId, s.groupId, settlement.id, { amount: '5' })),
      ).toBe('NOT_FOUND');
      expect(await codeOf(deleteSettlement.execute(userId, s.groupId, settlement.id))).toBe(
        'NOT_FOUND',
      );
      expect(await codeOf(listActivity.execute(userId, s.groupId, {}))).toBe('NOT_FOUND');
    }
  });

  it('answers 404 to a user who left the group', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000', { splitWith: [s.alice, s.bob] });
    await leave.execute(CAROL, s.groupId);

    expect(await codeOf(updateExpense.execute(CAROL, s.groupId, saved.id, edit(s)))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(listActivity.execute(CAROL, s.groupId, {}))).toBe('NOT_FOUND');
  });

  it('answers 404 for a missing record and for a record of another group', async () => {
    const s = await setup();
    const other = await createGroup.execute(ALICE, { name: 'Otra', defaultRateType: 'blue' });
    const saved = await newExpense(s, '4000000');
    const missing = '55555555-5555-4555-8555-555555555555';

    expect(await codeOf(updateExpense.execute(ALICE, s.groupId, missing, edit(s)))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(deleteExpense.execute(ALICE, other.group.id, saved.id))).toBe('NOT_FOUND');
    expect(await codeOf(deleteSettlement.execute(ALICE, s.groupId, missing))).toBe('NOT_FOUND');
    expect(await codeOf(updateSettlement.execute(ALICE, s.groupId, missing, { amount: '5' }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('UpdateGroupExpense', () => {
  it('recomputes the shares and the balances when 40,000.00 ARS becomes 60,000.00 ARS (AC-05)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    expect(balanceOf(await getBalances.execute(ALICE, s.groupId), 'ARS', s.bob)).toBe(2000000n);

    const updated = await updateExpense.execute(BOB, s.groupId, saved.id, edit(s));

    expect(updated.shares.map((share) => share.amount)).toEqual([3000000n, 3000000n]);
    const view = await getBalances.execute(ALICE, s.groupId);
    expect(balanceOf(view, 'ARS', s.bob)).toBe(3000000n);
    expect(balanceOf(view, 'ARS', s.alice)).toBe(-3000000n);
  });

  it('keeps the stored payer, creator and currency whatever the edit says (D2)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000', { currency: 'USD' });

    const updated = await updateExpense.execute(
      ALICE,
      s.groupId,
      saved.id,
      edit(s, { split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id, s.carol.id] } }),
    );

    expect(updated).toMatchObject({
      id: saved.id,
      payerMemberId: s.bob.id,
      createdByMemberId: s.bob.id,
      currency: 'USD',
    });
    expect(updated.shares).toHaveLength(3);
  });

  it('allocates leftovers with the creation rule: the payer first, then joining order', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');

    const updated = await updateExpense.execute(
      BOB,
      s.groupId,
      saved.id,
      edit(s, {
        amount: '10000',
        split: { mode: 'equal', memberIds: [s.alice.id, s.bob.id, s.carol.id] },
      }),
    );

    const byMember = new Map(updated.shares.map((share) => [share.memberId, share.amount]));
    expect(byMember.get(s.bob.id)).toBe(3334n);
    expect(byMember.get(s.alice.id)).toBe(3333n);
    expect(byMember.get(s.carol.id)).toBe(3333n);
  });

  it('is an error with an invalid split: nothing changes and no log row is written (AC-07)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    const stored = structuredClone(expenses.expenses);
    const logBefore = expenses.activity.length;

    const invalid = [
      edit(s, {
        split: {
          mode: 'percentage',
          shares: [
            { memberId: s.alice.id, basisPoints: 5000 },
            { memberId: s.bob.id, basisPoints: 4000 },
          ],
        },
      }),
      edit(s, {
        split: {
          mode: 'exact',
          shares: [
            { memberId: s.alice.id, amount: '1' },
            { memberId: s.bob.id, amount: '1' },
          ],
        },
      }),
      edit(s, { split: { mode: 'equal', memberIds: [s.alice.id, STRANGER] } }),
      edit(s, { categoryId: STRANGER }),
    ];
    const codes = await Promise.all(
      invalid.map((body) => codeOf(updateExpense.execute(BOB, s.groupId, saved.id, body))),
    );

    expect(codes).toEqual([
      'GROUP_SPLIT_PERCENTAGE_INVALID',
      'GROUP_SPLIT_AMOUNT_MISMATCH',
      'GROUP_SPLIT_MEMBER_INVALID',
      'GROUP_EXPENSE_CATEGORY_INVALID',
    ]);
    expect(expenses.expenses).toEqual(stored);
    expect(expenses.activity).toHaveLength(logBefore);
  });

  it('is an invalid request with an amount of 0 or a date more than 1 day ahead (400)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');

    expect(
      await codeOf(updateExpense.execute(BOB, s.groupId, saved.id, edit(s, { amount: '0' }))),
    ).toBe('VALIDATION_FAILED');
    const tooFar = new Date(clock.now().getTime() + DAY_MS + 1000).toISOString();
    expect(
      await codeOf(
        updateExpense.execute(BOB, s.groupId, saved.id, edit(s, { occurredAt: tooFar })),
      ),
    ).toBe('VALIDATION_FAILED');
    const ok = new Date(clock.now().getTime() + DAY_MS).toISOString();
    await updateExpense.execute(BOB, s.groupId, saved.id, edit(s, { occurredAt: ok }));
  });

  it('writes a log entry with the action, the member, the clock instant and the before and after values (AC-08)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    clock.advance(5000);
    const at = clock.now();

    await updateExpense.execute(ALICE, s.groupId, saved.id, edit(s));

    const rows = expenses.activity.filter((row) => row.action === 'expense_updated');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      groupId: s.groupId,
      memberId: s.alice.id,
      subjectId: saved.id,
      createdAt: at,
    });
    expect(expenseSnapshotSchema.parse(row?.before)).toMatchObject({
      amount: '4000000',
      currency: 'ARS',
      description: 'Cena',
      payerMemberId: s.bob.id,
    });
    expect(expenseSnapshotSchema.parse(row?.after)).toMatchObject({
      amount: '6000000',
      description: 'Cena editada',
      shares: expect.arrayContaining([
        { memberId: s.alice.id, amount: '3000000' },
        { memberId: s.bob.id, amount: '3000000' },
      ]) as unknown,
    });
  });

  it('follows the payer movement under the payer scope, even when an admin edits (D6)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    expect(saved.payerMovementId).not.toBeNull();
    const movementId = saved.payerMovementId as string;

    await updateExpense.execute(ALICE, s.groupId, saved.id, edit(s, { description: 'Nueva nota' }));

    expect(recorder.calls).toEqual([
      expect.objectContaining({
        kind: 'update',
        userId: BOB,
        movementId,
        amount: 6000000n,
        note: 'Nueva nota',
      }),
    ]);
    expect(recorder.movements.find((m) => m.id === movementId)).toMatchObject({
      amount: 6000000n,
      note: 'Nueva nota',
    });
  });

  it('touches no movement when the expense has no payer movement id', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000', { userId: ALICE });
    expect(saved.payerMovementId).toBeNull();

    await updateExpense.execute(ALICE, s.groupId, saved.id, edit(s));
    await deleteExpense.execute(ALICE, s.groupId, saved.id);

    expect(recorder.calls).toEqual([]);
  });

  it('leaves the expense, the log and the movement unchanged when the repository write fails (AC-08 atomicity)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    const stored = structuredClone(expenses.expenses);
    const movements = structuredClone(recorder.movements);
    const logBefore = expenses.activity.length;
    const balancesBefore = await getBalances.execute(ALICE, s.groupId);
    expenses.failAfterMovement = true;

    await expect(updateExpense.execute(BOB, s.groupId, saved.id, edit(s))).rejects.toThrow(
      'forced failure',
    );
    await expect(deleteExpense.execute(BOB, s.groupId, saved.id)).rejects.toThrow('forced failure');

    expect(expenses.expenses).toEqual(stored);
    expect(recorder.movements).toEqual(movements);
    expect(expenses.activity).toHaveLength(logBefore);
    expect(await getBalances.execute(ALICE, s.groupId)).toEqual(balancesBefore);
  });
});

describe('DeleteGroupExpense', () => {
  it('writes a log entry with the action, the member, the instant and the values it had (AC-09)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    clock.advance(7000);
    const at = clock.now();

    await deleteExpense.execute(BOB, s.groupId, saved.id);

    const row = expenses.activity.find((r) => r.action === 'expense_deleted');
    expect(row).toMatchObject({
      memberId: s.bob.id,
      subjectId: saved.id,
      createdAt: at,
      after: null,
    });
    expect(expenseSnapshotSchema.parse(row?.before)).toEqual(expenseSnapshot(saved));
  });

  it('removes the payer movement together with the expense (D6)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    const movementId = saved.payerMovementId as string;

    await deleteExpense.execute(BOB, s.groupId, saved.id);

    expect(recorder.calls).toEqual([
      expect.objectContaining({ kind: 'remove', userId: BOB, movementId }),
    ]);
    expect(recorder.movements.find((m) => m.id === movementId)).toBeUndefined();
  });
});

describe('settlement changes', () => {
  it('restores the balances to what they were before the settlement when it is deleted (AC-06)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const before = await getBalances.execute(ALICE, s.groupId);
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    expect(await getBalances.execute(ALICE, s.groupId)).not.toEqual(before);

    await deleteSettlement.execute(ALICE, s.groupId, saved.id);

    expect(await getBalances.execute(ALICE, s.groupId)).toEqual(before);
  });

  it('changes only the amount, only the date, or both, and the single leg follows', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    const newDate = new Date(clock.now().getTime() - DAY_MS);

    const dateOnly = await updateSettlement.execute(ALICE, s.groupId, saved.id, {
      occurredAt: newDate.toISOString(),
    });
    expect(dateOnly).toMatchObject({ amount: 1000000n, occurredAt: newDate });

    const both = await updateSettlement.execute(ALICE, s.groupId, saved.id, {
      amount: '2000000',
      occurredAt: clock.now().toISOString(),
    });
    expect(both.legs).toEqual([{ currency: 'ARS', amount: 2000000n }]);
    expect(both).toMatchObject({ fromMemberId: s.alice.id, toMemberId: s.bob.id, currency: 'ARS' });
    expect(balanceOf(await getBalances.execute(ALICE, s.groupId), 'ARS', s.alice)).toBe(0n);
  });

  it('is an invalid request with an amount of 0 or a date more than 1 day ahead (400)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);

    expect(
      await codeOf(updateSettlement.execute(ALICE, s.groupId, saved.id, { amount: '0' })),
    ).toBe('VALIDATION_FAILED');
    const tooFar = new Date(clock.now().getTime() + DAY_MS + 1000).toISOString();
    expect(
      await codeOf(updateSettlement.execute(ALICE, s.groupId, saved.id, { occurredAt: tooFar })),
    ).toBe('VALIDATION_FAILED');
  });

  it('writes the log entries of an edit and of a deletion with the settlement snapshots (AC-08, AC-09)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    clock.advance(3000);
    const editedAt = clock.now();
    await updateSettlement
      .execute(BOB, s.groupId, saved.id, { amount: '1500000' })
      .catch(() => undefined);
    await updateSettlement.execute(ALICE, s.groupId, saved.id, { amount: '1500000' });
    clock.advance(3000);
    const deletedAt = clock.now();
    await deleteSettlement.execute(ALICE, s.groupId, saved.id);

    const updated = expenses.activity.find((r) => r.action === 'settlement_updated');
    expect(updated).toMatchObject({
      memberId: s.alice.id,
      subjectId: saved.id,
      createdAt: editedAt,
    });
    expect(settlementSnapshotSchema.parse(updated?.before)).toMatchObject({
      amount: '1000000',
      legs: [{ currency: 'ARS', amount: '1000000' }],
    });
    expect(settlementSnapshotSchema.parse(updated?.after)).toMatchObject({
      amount: '1500000',
      legs: [{ currency: 'ARS', amount: '1500000' }],
    });
    const deleted = expenses.activity.find((r) => r.action === 'settlement_deleted');
    expect(deleted).toMatchObject({ createdAt: deletedAt, after: null });
    expect(settlementSnapshotSchema.parse(deleted?.before)).toMatchObject({ amount: '1500000' });
  });

  it('leaves the settlement and the log unchanged when the repository write fails (AC-08 atomicity)', async () => {
    const s = await setup();
    await newExpense(s, '4000000');
    const saved = await newSettlement(s, s.alice, s.bob, '1000000', ALICE);
    const stored = structuredClone(settlements.settlements);
    const logBefore = expenses.activity.length;
    settlements.failAfterLegs = true;

    await expect(
      updateSettlement.execute(ALICE, s.groupId, saved.id, { amount: '5' }),
    ).rejects.toThrow('forced failure');
    await expect(deleteSettlement.execute(ALICE, s.groupId, saved.id)).rejects.toThrow(
      'forced failure',
    );

    expect(settlements.settlements).toEqual(stored);
    expect(expenses.activity).toHaveLength(logBefore);
  });
});

describe('consolidated settlements', () => {
  async function consolidated(
    s: Setup,
  ): Promise<{ saved: GroupSettlement; before: GroupBalances }> {
    await newExpense(s, '20000', { currency: 'USD', splitWith: [s.alice, s.bob] });
    await newExpense(s, '10000000', {
      userId: ALICE,
      payer: s.alice,
      splitWith: [s.alice, s.bob],
    });
    rates.set('blue', RATE_1000);
    const before = await getBalances.execute(ALICE, s.groupId);
    const view = await preview.execute(ALICE, s.groupId, {
      memberA: s.alice.id,
      memberB: s.bob.id,
      currency: 'USD',
    });
    const saved = await recordSettlement.execute(ALICE, s.groupId, {
      kind: 'consolidated',
      memberIds: [s.alice.id, s.bob.id],
      legs: { ARS: view.legs.ARS.toString(), USD: view.legs.USD.toString() },
      currency: 'USD',
      occurredAt: clock.now().toISOString(),
    });
    return { saved, before };
  }

  it('answers 409 to an edit of a consolidated settlement; deleting it restores both currencies', async () => {
    const s = await setup();
    const { saved, before } = await consolidated(s);
    expect(saved.legs).toHaveLength(2);
    expect(await getBalances.execute(ALICE, s.groupId)).not.toEqual(before);

    expect(
      await codeOf(updateSettlement.execute(ALICE, s.groupId, saved.id, { amount: '5' })),
    ).toBe('GROUP_SETTLEMENT_CONSOLIDATED');
    expect(settlements.settlements[0]).toEqual(saved);

    await deleteSettlement.execute(ALICE, s.groupId, saved.id);
    expect(await getBalances.execute(ALICE, s.groupId)).toEqual(before);
  });
});

describe('members who left (D5)', () => {
  /** Bob pays 100.00 split with Carol; Carol settles her half and leaves at balance 0. */
  async function carolLeft(s: Setup) {
    const saved = await newExpense(s, '10000', { splitWith: [s.bob, s.carol] });
    const settlement = await newSettlement(s, s.carol, s.bob, '5000', CAROL);
    await leave.execute(CAROL, s.groupId);
    return { saved, settlement };
  }

  it('answers 409 to an edit or a deletion that would change the balance of a member who left, and nothing changes', async () => {
    const s = await setup();
    const { saved, settlement } = await carolLeft(s);
    const stored = structuredClone(expenses.expenses);
    const storedSettlements = structuredClone(settlements.settlements);
    const logBefore = expenses.activity.length;

    const changed = edit(s, {
      amount: '20000',
      split: { mode: 'equal', memberIds: [s.bob.id, s.carol.id] },
    });
    expect(await codeOf(updateExpense.execute(BOB, s.groupId, saved.id, changed))).toBe(
      'GROUP_RECORD_FORMER_MEMBER',
    );
    expect(await codeOf(updateExpense.execute(BOB, s.groupId, saved.id, edit(s)))).toBe(
      'GROUP_RECORD_FORMER_MEMBER',
    );
    expect(await codeOf(deleteExpense.execute(BOB, s.groupId, saved.id))).toBe(
      'GROUP_RECORD_FORMER_MEMBER',
    );
    expect(
      await codeOf(updateSettlement.execute(ALICE, s.groupId, settlement.id, { amount: '1' })),
    ).toBe('GROUP_RECORD_FORMER_MEMBER');
    expect(await codeOf(deleteSettlement.execute(ALICE, s.groupId, settlement.id))).toBe(
      'GROUP_RECORD_FORMER_MEMBER',
    );

    expect(expenses.expenses).toEqual(stored);
    expect(settlements.settlements).toEqual(storedSettlements);
    expect(expenses.activity).toHaveLength(logBefore);
    expect(settlements.hasOpenBalance(s.groupId, s.carol.id)).toBe(false);
  });

  it('allows an edit that leaves the former member balance as it was (description only)', async () => {
    const s = await setup();
    const { saved } = await carolLeft(s);

    const updated = await updateExpense.execute(
      BOB,
      s.groupId,
      saved.id,
      edit(s, {
        amount: '10000',
        description: 'Solo la nota',
        split: { mode: 'equal', memberIds: [s.bob.id, s.carol.id] },
      }),
    );

    expect(updated.description).toBe('Solo la nota');
    expect(settlements.hasOpenBalance(s.groupId, s.carol.id)).toBe(false);
  });

  it('is a conflict at the repository when a member leaves between the read and the write (lock-time recheck)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '10000', { splitWith: [s.bob, s.carol] });
    await newSettlement(s, s.carol, s.bob, '5000', CAROL);
    await leave.execute(CAROL, s.groupId);

    await expect(
      expenses.deleteExpense({
        groupId: s.groupId,
        expenseId: saved.id,
        rateType: 'blue',
        activity: {
          action: 'expense_deleted',
          memberId: s.bob.id,
          createdAt: clock.now(),
          before: expenseSnapshot(saved),
          after: null,
        },
      }),
    ).rejects.toBeInstanceOf(GroupRecordFormerMember);
  });
});

describe('ListActivity', () => {
  it('lists every entry newest first to any member, the log of a deleted record included (AC-10)', async () => {
    const s = await setup();
    const saved = await newExpense(s, '4000000');
    clock.advance(1000);
    await updateExpense.execute(BOB, s.groupId, saved.id, edit(s));
    clock.advance(1000);
    await deleteExpense.execute(BOB, s.groupId, saved.id);

    for (const userId of [ALICE, BOB, CAROL]) {
      const page = await listActivity.execute(userId, s.groupId, {});
      expect(page.items.map((entry) => entry.action)).toEqual([
        'expense_deleted',
        'expense_updated',
        'expense_created',
      ]);
      expect(page.nextCursor).toBeNull();
    }
    const page = await listActivity.execute(ALICE, s.groupId, {});
    expect(page.items[0]).toMatchObject({
      subjectType: 'expense',
      subjectId: saved.id,
      after: null,
    });
    expect(page.items[2]).toMatchObject({ before: null, after: null });
  });

  it('pages with a limit and an opaque cursor without repeating entries and shows nothing of other groups', async () => {
    const s = await setup();
    const other = await createGroup.execute(ALICE, { name: 'Otra', defaultRateType: 'blue' });
    for (let index = 0; index < 5; index += 1) {
      clock.advance(1000);
      await newExpense(s, `${(index + 1) * 1000}`);
    }
    await recordExpense.execute(ALICE, other.group.id, {
      amount: '100',
      currency: 'ARS',
      occurredAt: clock.now().toISOString(),
      payerMemberId: ((await groups.findMember(other.group.id, ALICE)) as Member).id,
      categoryId: ((await groups.listCategories(other.group.id))[0] as { id: string }).id,
      description: 'Otro',
      split: {
        mode: 'equal',
        memberIds: [((await groups.findMember(other.group.id, ALICE)) as Member).id],
      },
      payerAccount: {
        accountId: recorder.seedAccount(ALICE, 'ARS'),
        categoryId: recorder.seedCategory(ALICE),
      },
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listActivity.execute(BOB, s.groupId, {
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((entry) => entry.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const all = await listActivity.execute(BOB, s.groupId, { limit: 100 });
    expect(all.items.map((entry) => entry.id)).toEqual(seen);
  });
});

describe('snapshots (D7)', () => {
  it('stores every amount as an integer string and sorts shares by member', async () => {
    const s = await setup();
    const saved = await newExpense(s, '10000', { splitWith: [s.alice, s.bob, s.carol] });
    const snapshot = expenseSnapshot(saved);

    expect(expenseSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(typeof snapshot.amount).toBe('string');
    expect(snapshot.shares.every((share) => typeof share.amount === 'string')).toBe(true);
    const ids = snapshot.shares.map((share) => share.memberId);
    expect(ids).toEqual([...ids].sort());
    expect(snapshot.occurredAt).toBe(saved.occurredAt.toISOString());

    const settlement = await newSettlement(s, s.alice, s.bob, '1000', ALICE);
    expect(settlementSnapshotSchema.parse(settlementSnapshot(settlement))).toEqual({
      fromMemberId: s.alice.id,
      toMemberId: s.bob.id,
      currency: 'ARS',
      amount: '1000',
      occurredAt: settlement.occurredAt.toISOString(),
      legs: [{ currency: 'ARS', amount: '1000' }],
    });
  });
});

/** Mulberry32: a small seeded PRNG so the run is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random operations', () => {
  it('keeps the sum of balances at 0 in each currency over 10,000 creates, edits, deletes and settlements (AC-05, AC-06)', async () => {
    const s = await setup();
    const extra = [
      groups.seedMember(s.groupId, null, 'Ana'),
      groups.seedMember(s.groupId, null, 'Luis'),
    ];
    const everyone = [s.alice, s.bob, s.carol, s.ghost, ...extra];
    const random = seededRandom(20261010);
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
    const accounts = {
      ARS: {
        accountId: recorder.seedAccount(ALICE, 'ARS'),
        categoryId: recorder.seedCategory(ALICE),
      },
      USD: {
        accountId: recorder.seedAccount(ALICE, 'USD'),
        categoryId: recorder.seedCategory(ALICE),
      },
    };
    const subset = () => {
      const size = int(1, everyone.length);
      return [...everyone].sort(() => random() - 0.5).slice(0, size);
    };
    const sumsAreZero = async () => {
      const view = await getBalances.execute(ALICE, s.groupId);
      for (const currency of ['ARS', 'USD'] as const) {
        expect(view[currency].members.reduce((total, m) => total + m.balance, 0n)).toBe(0n);
      }
    };
    const counts = { create: 0, edit: 0, remove: 0, settle: 0, settleEdit: 0, settleRemove: 0 };
    const date = () => clock.now().toISOString();

    const started = Date.now();
    for (let op = 1; op <= 10_000; op += 1) {
      const roll = random();
      const currency: AccountCurrency = random() < 0.5 ? 'ARS' : 'USD';
      if (roll < 0.35 || (expenses.expenses.length === 0 && roll < 0.8)) {
        const payer = pick(everyone);
        await recordExpense.execute(ALICE, s.groupId, {
          amount: String(int(1, 10_000_000)),
          currency,
          occurredAt: date(),
          payerMemberId: payer.id,
          categoryId: s.categoryId,
          description: 'Gasto',
          split: { mode: 'equal', memberIds: subset().map((m) => m.id) },
          ...(payer.id === s.alice.id ? { payerAccount: accounts[currency] } : {}),
        });
        counts.create += 1;
      } else if (roll < 0.55) {
        const target = pick(expenses.expenses);
        const members = subset();
        const exact = random() < 0.3;
        const amount = int(1, 10_000_000);
        const first = Math.floor(amount / 2);
        await updateExpense.execute(ALICE, s.groupId, target.id, {
          amount: String(amount),
          occurredAt: date(),
          categoryId: s.categoryId,
          description: 'Editado',
          split: exact
            ? {
                mode: 'exact',
                shares: [
                  { memberId: s.alice.id, amount: String(first) },
                  { memberId: s.bob.id, amount: String(amount - first) },
                ],
              }
            : { mode: 'equal', memberIds: members.map((m) => m.id) },
        });
        counts.edit += 1;
      } else if (roll < 0.65 && expenses.expenses.length > 0) {
        await deleteExpense.execute(ALICE, s.groupId, pick(expenses.expenses).id);
        counts.remove += 1;
      } else if (roll < 0.9) {
        const from = pick(everyone);
        const to = pick(everyone.filter((m) => m.id !== from.id));
        await recordSettlement.execute(ALICE, s.groupId, {
          kind: 'single',
          fromMemberId: from.id,
          toMemberId: to.id,
          currency,
          amount: String(int(1, 5_000_000)),
          occurredAt: date(),
        });
        counts.settle += 1;
      } else if (roll < 0.96 && settlements.settlements.length > 0) {
        await updateSettlement.execute(ALICE, s.groupId, pick(settlements.settlements).id, {
          amount: String(int(1, 5_000_000)),
        });
        counts.settleEdit += 1;
      } else if (settlements.settlements.length > 0) {
        await deleteSettlement.execute(ALICE, s.groupId, pick(settlements.settlements).id);
        counts.settleRemove += 1;
      }
      if (op % 500 === 0) await sumsAreZero();
    }
    await sumsAreZero();

    // The incremental ledger of the fake matches balances recomputed from the stored rows.
    const view = await getBalances.execute(ALICE, s.groupId);
    for (const currency of ['ARS', 'USD'] as const) {
      const expected = new Map<string, bigint>();
      const add = (id: string, value: bigint) => expected.set(id, (expected.get(id) ?? 0n) + value);
      for (const e of expenses.expenses.filter((x) => x.currency === currency)) {
        add(e.payerMemberId, e.amount);
        for (const share of e.shares) add(share.memberId, -share.amount);
      }
      for (const st of settlements.settlements) {
        for (const leg of st.legs.filter((l) => l.currency === currency)) {
          add(st.fromMemberId, leg.amount);
          add(st.toMemberId, -leg.amount);
        }
      }
      for (const member of view[currency].members) {
        expect(member.balance).toBe(expected.get(member.memberId) ?? 0n);
      }
    }
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
