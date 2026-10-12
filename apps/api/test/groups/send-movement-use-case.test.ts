import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppError, AUTOMATIC_SEND_CATEGORY_KEY, type GroupSplit } from '@pesly/shared';
import {
  CreateGroup,
  CreateGroupCategory,
  CreateInvitation,
  JoinGroup,
  SendMovementToGroup,
  UpdateGroupCategory,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { DeterministicTokenSource, FakeClock, InMemoryGroupRepository } from './fakes';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const DAVE = '44444444-4444-4444-8444-444444444444';
const STRANGER = '99999999-9999-4999-8999-999999999999';

let clock: FakeClock;
let tokens: DeterministicTokenSource;
let groups: InMemoryGroupRepository;
let recorder: InMemoryPayerMovementRecorder;
let expenses: InMemoryGroupExpenseRepository;
let createGroup: CreateGroup;
let createInvitation: CreateInvitation;
let joinGroup: JoinGroup;
let createCategory: CreateGroupCategory;
let updateCategory: UpdateGroupCategory;
let send: SendMovementToGroup;

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
  createCategory = new CreateGroupCategory(deps);
  updateCategory = new UpdateGroupCategory(deps);
  send = new SendMovementToGroup(deps);
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

interface Setup {
  groupId: string;
  alice: Member;
  bob: Member;
  others: Member[];
}

/** Alice (admin) and Bob, plus Carol and Dave when `members` is 4. */
async function setup(members = 2): Promise<Setup> {
  const created = await createGroup.execute(ALICE, { name: 'Casa', defaultRateType: 'blue' });
  const groupId = created.group.id;
  for (const user of [BOB, CAROL, DAVE].slice(0, members - 1)) {
    const invitation = await createInvitation.execute(ALICE, groupId);
    await joinGroup.execute(user, invitation.token);
    clock.advance(1000);
  }
  const alice = (await groups.findMember(groupId, ALICE)) as Member;
  const bob = (await groups.findMember(groupId, BOB)) as Member;
  const others = groups.membersOf(groupId).filter((m) => m.id !== alice.id);
  return { groupId, alice, bob, others };
}

function equal(...ids: string[]): GroupSplit {
  return { mode: 'equal', memberIds: ids };
}

function snapshot(): string {
  return JSON.stringify(
    {
      expenses: expenses.expenses,
      activity: expenses.activity,
      categories: [...groups.categories.entries()],
      adoptable: [...recorder.adoptable.entries()],
      movements: recorder.movements,
      calls: recorder.calls,
    },
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
  );
}

function dropAutomaticCategory(groupId: string): void {
  groups.categories.set(
    groupId,
    (groups.categories.get(groupId) ?? []).filter(
      (c) => c.defaultKey !== AUTOMATIC_SEND_CATEGORY_KEY,
    ),
  );
}

describe('SendMovementToGroup', () => {
  it('splits a 40,000.00 ARS movement among 4 members into 4 shares of 10,000.00 (AC-12)', async () => {
    const { groupId, alice, others } = await setup(4);
    const movementId = recorder.seedMovement(ALICE, { amount: 4_000_000n });
    const ids = [alice.id, ...others.map((m) => m.id)];

    const saved = await send.execute(ALICE, groupId, { movementId, split: equal(...ids) });

    expect(saved.amount).toBe(4_000_000n);
    expect(saved.currency).toBe('ARS');
    expect(saved.payerMemberId).toBe(alice.id);
    expect(saved.payerMovementId).toBe(movementId);
    expect(saved.adoptedMovement).toBe(true);
    expect(saved.shares).toHaveLength(4);
    expect(saved.shares.every((share) => share.amount === 1_000_000n)).toBe(true);
    expect(expenses.expenses).toHaveLength(1);
    expect(recorder.movements).toHaveLength(0);
    expect(expenses.activity[0]?.fromMovement).toBe(true);
  });

  it.each(['income', 'transfer', 'exchange'] as const)(
    'rejects a %s movement with GROUP_MOVEMENT_NOT_EXPENSE and saves nothing (AC-03)',
    async (type) => {
      const { groupId, alice } = await setup();
      const movementId = recorder.seedMovement(ALICE, { type });
      const before = snapshot();

      const code = await codeOf(
        send.execute(ALICE, groupId, { movementId, split: equal(alice.id) }),
      );

      expect(code).toBe('GROUP_MOVEMENT_NOT_EXPENSE');
      expect(snapshot()).toBe(before);
    },
  );

  it('rejects an already linked movement with GROUP_MOVEMENT_ALREADY_SENT (AC-21)', async () => {
    const { groupId, alice } = await setup();
    const movementId = recorder.seedMovement(ALICE, { linked: true });

    const code = await codeOf(send.execute(ALICE, groupId, { movementId, split: equal(alice.id) }));

    expect(code).toBe('GROUP_MOVEMENT_ALREADY_SENT');
    expect(expenses.expenses).toHaveLength(0);
  });

  it('answers 404 for another user movement, an unknown movement and a foreign group (AC-32, AC-33)', async () => {
    const { groupId, alice } = await setup();
    const foreign = recorder.seedMovement(BOB);
    const own = recorder.seedMovement(ALICE);
    const split = equal(alice.id);

    await expect(
      send.execute(ALICE, groupId, { movementId: foreign, split }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      send.execute(ALICE, groupId, { movementId: randomUUID(), split }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      send.execute(STRANGER, groupId, { movementId: own, split }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(expenses.expenses).toHaveLength(0);
  });

  it('rejects a category of another group, an archived one and a non-member in the split (AC-19, AC-20)', async () => {
    const { groupId, alice } = await setup();
    const other = await createGroup.execute(BOB, { name: 'Otra', defaultRateType: 'blue' });
    const foreign = (await groups.listCategories(other.group.id))[0] as { id: string };
    const own = (await groups.listCategories(groupId))[0] as { id: string };
    await updateCategory.execute(ALICE, groupId, own.id, { archived: true });
    const movementId = recorder.seedMovement(ALICE);

    expect(
      await codeOf(
        send.execute(ALICE, groupId, {
          movementId,
          categoryId: foreign.id,
          split: equal(alice.id),
        }),
      ),
    ).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
    expect(
      await codeOf(
        send.execute(ALICE, groupId, { movementId, categoryId: own.id, split: equal(alice.id) }),
      ),
    ).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
    expect(
      await codeOf(
        send.execute(ALICE, groupId, { movementId, split: equal(alice.id, randomUUID()) }),
      ),
    ).toBe('GROUP_SPLIT_MEMBER_INVALID');
    expect(expenses.expenses).toHaveLength(0);
  });

  it('passes a null category when none is sent and returns the autoCategory the repository reports (AC-45, AC-46, AC-47)', async () => {
    const { groupId, alice } = await setup();
    const split = equal(alice.id);
    const find = async (): Promise<{ id: string }> =>
      (await groups.listCategories(groupId)).find(
        (c) => c.defaultKey === AUTOMATIC_SEND_CATEGORY_KEY,
      ) as { id: string };

    const first = await send.execute(ALICE, groupId, {
      movementId: recorder.seedMovement(ALICE),
      split,
    });
    expect(expenses.saveCalls[0]?.categoryId).toBeNull();
    expect(first.autoCategory).toBeNull();
    expect(first.categoryId).toBe((await find()).id);

    await updateCategory.execute(ALICE, groupId, (await find()).id, { archived: true });
    const second = await send.execute(ALICE, groupId, {
      movementId: recorder.seedMovement(ALICE),
      split,
    });
    expect(second.autoCategory).toBe('restored');

    dropAutomaticCategory(groupId);
    const third = await send.execute(ALICE, groupId, {
      movementId: recorder.seedMovement(ALICE),
      split,
    });
    expect(third.autoCategory).toBe('created');
    expect(expenses.activity.at(-1)?.autoCategory).toBe('created');
  });

  it('lets a non-admin send into a group with no "Other expenses" category (AC-50)', async () => {
    const { groupId, bob } = await setup();
    dropAutomaticCategory(groupId);
    const movementId = recorder.seedMovement(BOB);

    const saved = await send.execute(BOB, groupId, { movementId, split: equal(bob.id) });

    expect(saved.autoCategory).toBe('created');
    expect(
      await codeOf(
        createCategory.execute(BOB, groupId, { name: 'Nueva', icon: 'ellipsis', color: 'slate' }),
      ),
    ).toBe('GROUP_ADMIN_REQUIRED');
  });

  it('leaves the categories unchanged when the send is refused (AC-49)', async () => {
    const { groupId, alice } = await setup();
    dropAutomaticCategory(groupId);
    const linked = recorder.seedMovement(ALICE, { linked: true });
    const fresh = recorder.seedMovement(ALICE);
    const before = JSON.stringify([...groups.categories.entries()]);

    await codeOf(send.execute(ALICE, groupId, { movementId: linked, split: equal(alice.id) }));
    await codeOf(
      send.execute(ALICE, groupId, {
        movementId: fresh,
        split: { mode: 'percentage', shares: [{ memberId: alice.id, basisPoints: 5000 }] },
      }),
    );

    expect(JSON.stringify([...groups.categories.entries()])).toBe(before);
  });

  it('derives the description from the note and rejects an empty or null note (AC-07, AC-22)', async () => {
    const { groupId, alice } = await setup();
    const split = equal(alice.id);
    const long = `  ${'a'.repeat(150)}   ${'b'.repeat(150)}  `;

    const derived = await send.execute(ALICE, groupId, {
      movementId: recorder.seedMovement(ALICE, { note: long }),
      split,
    });
    expect(derived.description).toBe(`${'a'.repeat(150)} ${'b'.repeat(49)}`);
    expect(derived.description.length).toBe(200);

    const explicit = await send.execute(ALICE, groupId, {
      movementId: recorder.seedMovement(ALICE, { note: 'x' }),
      description: 'Cena',
      split,
    });
    expect(explicit.description).toBe('Cena');

    for (const note of [null, '', '   ']) {
      const movementId = recorder.seedMovement(ALICE, { note });
      let error: unknown;
      try {
        await send.execute(ALICE, groupId, { movementId, split });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
      expect((error as AppError).fields).toEqual(['body.description']);
    }
    expect(expenses.expenses).toHaveLength(2);
  });

  it('rejects percentages not totalling 100 and exact amounts not totalling the movement before any write (AC-11)', async () => {
    const { groupId, alice, bob } = await setup();
    const movementId = recorder.seedMovement(ALICE, { amount: 1000n });
    const before = snapshot();

    expect(
      await codeOf(
        send.execute(ALICE, groupId, {
          movementId,
          split: {
            mode: 'percentage',
            shares: [
              { memberId: alice.id, basisPoints: 5000 },
              { memberId: bob.id, basisPoints: 4000 },
            ],
          },
        }),
      ),
    ).toBe('GROUP_SPLIT_PERCENTAGE_INVALID');
    const exact = await codeOf(
      send.execute(ALICE, groupId, {
        movementId,
        split: {
          mode: 'exact',
          shares: [
            { memberId: alice.id, amount: '400' },
            { memberId: bob.id, amount: '500' },
          ],
        },
      }),
    );
    expect(exact).toBe('GROUP_SPLIT_AMOUNT_MISMATCH');
    expect(snapshot()).toBe(before);
  });

  it('keeps the expense amount and the shares equal to the movement for 1,000 random amounts (NFR-05)', async () => {
    const { groupId, alice, others } = await setup(4);
    const ids = [alice.id, ...others.map((m) => m.id)];
    for (let i = 0; i < 1000; i += 1) {
      const amount = BigInt(1 + Math.floor(Math.random() * 1_000_000_000));
      const movementId = recorder.seedMovement(ALICE, { amount });
      const saved = await send.execute(ALICE, groupId, { movementId, split: equal(...ids) });
      const total = saved.shares.reduce((sum, share) => sum + share.amount, 0n);
      expect(saved.amount).toBe(amount);
      expect(total).toBe(amount);
    }
  });

  it('writes nothing when a send is refused (AC-14, NFR-07)', async () => {
    const { groupId, alice } = await setup();
    const linked = recorder.seedMovement(ALICE, { linked: true });
    const income = recorder.seedMovement(ALICE, { type: 'income' });
    const fresh = recorder.seedMovement(ALICE);
    const before = snapshot();

    await codeOf(send.execute(ALICE, groupId, { movementId: linked, split: equal(alice.id) }));
    await codeOf(send.execute(ALICE, groupId, { movementId: income, split: equal(alice.id) }));
    await codeOf(send.execute(ALICE, groupId, { movementId: fresh, split: equal(randomUUID()) }));

    expect(snapshot()).toBe(before);
    expect(expenses.saveCalls).toHaveLength(0);
  });
});
