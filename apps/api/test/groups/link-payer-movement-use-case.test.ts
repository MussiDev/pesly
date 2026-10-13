import { AppError, type CreateGroupExpenseRequest } from '@pesly/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AddGhostMember,
  CreateGroup,
  CreateInvitation,
  JoinGroup,
  LinkPayerMovement,
  ListMovementCandidates,
  RecordGroupExpense,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';
import { DeterministicTokenSource, FakeClock, InMemoryGroupRepository } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';

let clock: FakeClock;
let groups: InMemoryGroupRepository;
let recorder: InMemoryPayerMovementRecorder;
let expenses: InMemoryGroupExpenseRepository;
let record: RecordGroupExpense;
let link: LinkPayerMovement;
let candidates: ListMovementCandidates;
let createGroup: CreateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let addGhost: AddGhostMember;

beforeEach(() => {
  clock = new FakeClock();
  const tokens = new DeterministicTokenSource();
  groups = new InMemoryGroupRepository(clock);
  recorder = new InMemoryPayerMovementRecorder();
  expenses = new InMemoryGroupExpenseRepository(groups, recorder);
  const deps = { groups, clock, tokens, expenses, payerMovements: recorder };
  createGroup = new CreateGroup(deps);
  createInvitation = new CreateInvitation(deps);
  joinGroup = new JoinGroup(deps);
  addGhost = new AddGhostMember(deps);
  record = new RecordGroupExpense(deps);
  link = new LinkPayerMovement(deps);
  candidates = new ListMovementCandidates(deps);
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
  ghost: Member;
  categoryId: string;
  aliceAccount: string;
  aliceCategory: string;
  expenseId: string;
}

/** Bob records an expense of 40,000.00 ARS that Alice paid, with no movement for her. */
async function setup(payer: 'alice' | 'ghost' = 'alice'): Promise<Setup> {
  const created = await createGroup.execute(ALICE, { name: 'Casa', defaultRateType: 'blue' });
  const groupId = created.group.id;
  await joinGroup.execute(BOB, (await createInvitation.execute(ALICE, groupId)).token);
  const ghost = await addGhost.execute(ALICE, groupId, { displayName: 'Pedro' });
  const alice = (await groups.findMember(groupId, ALICE)) as Member;
  const bob = (await groups.findMember(groupId, BOB)) as Member;
  const [category] = await groups.listCategories(groupId);
  const categoryId = (category as { id: string }).id;
  const body: CreateGroupExpenseRequest = {
    amount: '4000000',
    currency: 'ARS',
    occurredAt: clock.now().toISOString(),
    payerMemberId: payer === 'alice' ? alice.id : ghost.id,
    categoryId,
    description: 'Supermercado',
    split: { mode: 'equal', memberIds: [alice.id, bob.id] },
  };
  const expense = await record.execute(BOB, groupId, body);
  return {
    groupId,
    alice,
    bob,
    ghost,
    categoryId,
    aliceAccount: recorder.seedAccount(ALICE, 'ARS'),
    aliceCategory: recorder.seedCategory(ALICE),
    expenseId: expense.id,
  };
}

describe('LinkPayerMovement', () => {
  it('links in create mode, asking the repository to record the movement of the expense (AC-02, AC-07)', async () => {
    const s = await setup();

    const linked = await link.execute(ALICE, s.groupId, s.expenseId, {
      mode: 'create',
      accountId: s.aliceAccount,
      categoryId: s.aliceCategory,
    });

    expect(linked.payerMovementId).not.toBeNull();
    expect(expenses.linkCalls).toHaveLength(1);
    expect(expenses.linkCalls[0]?.link).toMatchObject({
      mode: 'create',
      movement: {
        userId: ALICE,
        accountId: s.aliceAccount,
        categoryId: s.aliceCategory,
        amount: 4_000_000n,
        note: 'Supermercado',
        rateType: 'blue',
      },
    });
  });

  it('links in adopt mode with the movement amount and date as the values the write must find (AC-11)', async () => {
    const s = await setup();
    const movementId = recorder.seedMovement(ALICE, { amount: 4_000_000n });

    const linked = await link.execute(ALICE, s.groupId, s.expenseId, { mode: 'adopt', movementId });

    expect(linked.payerMovementId).toBe(movementId);
    expect(expenses.linkCalls[0]?.link).toMatchObject({
      mode: 'adopt',
      movementId,
      expectedAmount: 4_000_000n,
    });
  });

  it('refuses a member who is not the payer before it looks at the account (AC-03)', async () => {
    const s = await setup();

    const code = await codeOf(
      link.execute(BOB, s.groupId, s.expenseId, {
        mode: 'create',
        accountId: s.aliceAccount,
        categoryId: s.aliceCategory,
      }),
    );

    expect(code).toBe('GROUP_PAYER_ONLY');
    expect(expenses.linkCalls).toHaveLength(0);
  });

  it('refuses an expense paid by a ghost member, whoever asks (AC-04)', async () => {
    const s = await setup('ghost');

    for (const user of [ALICE, BOB]) {
      const code = await codeOf(
        link.execute(user, s.groupId, s.expenseId, {
          mode: 'create',
          accountId: s.aliceAccount,
          categoryId: s.aliceCategory,
        }),
      );
      expect(code).toBe('GROUP_PAYER_ONLY');
    }
  });

  it('refuses an expense that already has a movement with a conflict (AC-05)', async () => {
    const s = await setup();
    const body = {
      mode: 'create' as const,
      accountId: s.aliceAccount,
      categoryId: s.aliceCategory,
    };
    await link.execute(ALICE, s.groupId, s.expenseId, body);

    expect(await codeOf(link.execute(ALICE, s.groupId, s.expenseId, body))).toBe(
      'GROUP_EXPENSE_ALREADY_LINKED',
    );
  });

  it('answers not found for a missing group, a missing expense and a user outside the group (AC-06)', async () => {
    const s = await setup();
    const body = { mode: 'adopt' as const, movementId: recorder.seedMovement(ALICE) };

    expect(await codeOf(link.execute(ALICE, s.groupId, s.alice.id, body))).toBe('NOT_FOUND');
    expect(await codeOf(link.execute(STRANGER, s.groupId, s.expenseId, body))).toBe('NOT_FOUND');
    expect(await codeOf(link.execute(ALICE, s.expenseId, s.expenseId, body))).toBe('NOT_FOUND');
  });

  it('rejects an account that is not usable with the same invalid account error (AC-08, AC-09)', async () => {
    const s = await setup();
    const foreign = recorder.seedAccount(BOB, 'ARS');
    const usd = recorder.seedAccount(ALICE, 'USD');
    const income = recorder.seedCategory(ALICE, 'income');

    for (const body of [
      { accountId: foreign, categoryId: s.aliceCategory },
      { accountId: usd, categoryId: s.aliceCategory },
      { accountId: s.aliceAccount, categoryId: income },
      { accountId: s.aliceAccount, categoryId: s.aliceCategory.replace(/./, '0') },
    ]) {
      expect(
        await codeOf(link.execute(ALICE, s.groupId, s.expenseId, { mode: 'create', ...body })),
      ).toBe('GROUP_PAYER_ACCOUNT_INVALID');
    }
    expect(expenses.linkCalls).toHaveLength(0);
  });

  it('rejects a movement that is not an expense, is linked, or differs in amount or currency (AC-12 to AC-14)', async () => {
    const s = await setup();
    const cases: [string, string][] = [
      [recorder.seedMovement(ALICE, { type: 'income' }), 'GROUP_MOVEMENT_NOT_EXPENSE'],
      [recorder.seedMovement(ALICE, { linked: true }), 'GROUP_MOVEMENT_ALREADY_SENT'],
      [recorder.seedMovement(ALICE, { amount: 4_000_001n }), 'GROUP_MOVEMENT_MISMATCH'],
      [recorder.seedMovement(ALICE, { currency: 'USD' }), 'GROUP_MOVEMENT_MISMATCH'],
    ];

    for (const [movementId, expected] of cases) {
      expect(
        await codeOf(link.execute(ALICE, s.groupId, s.expenseId, { mode: 'adopt', movementId })),
      ).toBe(expected);
    }
    expect(expenses.linkCalls).toHaveLength(0);
  });

  it('answers the same not found for a missing movement and for another user movement (AC-15, AC-31)', async () => {
    const s = await setup();
    const foreign = recorder.seedMovement(BOB);

    const missing = await codeOf(
      link.execute(ALICE, s.groupId, s.expenseId, { mode: 'adopt', movementId: s.groupId }),
    );
    const other = await codeOf(
      link.execute(ALICE, s.groupId, s.expenseId, { mode: 'adopt', movementId: foreign }),
    );

    expect(missing).toBe('NOT_FOUND');
    expect(other).toBe('NOT_FOUND');
  });
});

describe('ListMovementCandidates', () => {
  it('lists the payer own unlinked expense movements of the same amount and currency, and no other (AC-18)', async () => {
    const s = await setup();
    const wanted = recorder.seedMovement(ALICE);
    recorder.seedMovement(ALICE, { amount: 1n });
    recorder.seedMovement(ALICE, { type: 'income' });
    recorder.seedMovement(ALICE, { linked: true });
    recorder.seedMovement(BOB);

    const rows = await candidates.execute(ALICE, s.groupId, s.expenseId);

    expect(rows.map((row) => row.id)).toEqual([wanted]);
  });

  it('refuses a member who is not the payer and an expense already linked (AC-19)', async () => {
    const s = await setup();

    expect(await codeOf(candidates.execute(BOB, s.groupId, s.expenseId))).toBe('GROUP_PAYER_ONLY');
    await link.execute(ALICE, s.groupId, s.expenseId, {
      mode: 'adopt',
      movementId: recorder.seedMovement(ALICE),
    });
    expect(await codeOf(candidates.execute(ALICE, s.groupId, s.expenseId))).toBe(
      'GROUP_EXPENSE_ALREADY_LINKED',
    );
  });

  it('answers not found for a user outside the group (AC-06)', async () => {
    const s = await setup();

    expect(await codeOf(candidates.execute(STRANGER, s.groupId, s.expenseId))).toBe('NOT_FOUND');
  });
});
