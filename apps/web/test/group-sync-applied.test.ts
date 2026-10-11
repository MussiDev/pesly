// @vitest-environment happy-dom
import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient, ApiFailure, ApiResult } from '../src/lib/api-client';
import {
  loadGroupQueue,
  queueGroupDelete,
  queueGroupUpdate,
  readCachedGroupRecord,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { cancelSyncRetry, syncMovementQueue } from '../src/lib/sync/sync-queue';

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expenseRecord(version: number, amount = '10000'): GroupExpenseResponse {
  const half = String(BigInt(amount) / 2n);
  return {
    id: EXPENSE,
    groupId: GROUP,
    payerMemberId: MEMBER_A,
    createdByMemberId: MEMBER_A,
    amount,
    currency: 'ARS',
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'dinner',
    splitMode: 'equal',
    payerMovementId: null,
    createdAt: '2026-10-02T15:31:00.000Z',
    shares: [
      { memberId: MEMBER_A, amount: half },
      { memberId: MEMBER_B, amount: half },
    ],
    version,
  };
}

function settlementRecord(version: number, amount = '2500'): SettlementResponse {
  return {
    id: SETTLEMENT,
    groupId: GROUP,
    fromMemberId: MEMBER_A,
    toMemberId: MEMBER_B,
    currency: 'ARS',
    amount,
    legs: [{ currency: 'ARS', amount }],
    occurredAt: '2026-10-03T10:00:00.000Z',
    createdByMemberId: MEMBER_A,
    accountId: null,
    rate: null,
    rateSource: null,
    rateType: null,
    createdAt: '2026-10-03T10:01:00.000Z',
    version,
  };
}

// Members in another order than the server's shares: the comparison must not depend on it.
const equalSplit = { mode: 'equal' as const, memberIds: [MEMBER_B, MEMBER_A] };

function expenseEdit(amount: string) {
  return {
    amount,
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'dinner',
    split: equalSplit,
  };
}

function conflictOf(current: GroupExpenseResponse | SettlementResponse): ApiResult<never> {
  const failure: ApiFailure = {
    ok: false,
    code: 'GROUP_RECORD_CONFLICT',
    messageKey: 'unexpected',
  };
  return { ...failure, current };
}

function fakeApi(answers: {
  expense?: ApiResult<GroupExpenseResponse>;
  settlement?: ApiResult<SettlementResponse>;
  removeExpense?: ApiResult<undefined>;
}) {
  const unused = () => Promise.reject(new Error('not expected'));
  const api: Pick<
    ApiClient,
    | 'createMovement'
    | 'updateMovement'
    | 'deleteMovement'
    | 'updateGroupExpense'
    | 'deleteGroupExpense'
    | 'updateSettlement'
    | 'deleteSettlement'
  > = {
    createMovement: unused,
    updateMovement: unused,
    deleteMovement: unused,
    updateGroupExpense: () =>
      Promise.resolve(answers.expense ?? { ok: true, data: expenseRecord(9) }),
    deleteGroupExpense: () =>
      Promise.resolve(answers.removeExpense ?? { ok: true, data: undefined }),
    updateSettlement: () =>
      Promise.resolve(answers.settlement ?? { ok: true, data: settlementRecord(9) }),
    deleteSettlement: () => Promise.resolve({ ok: true, data: undefined }),
  };
  return api;
}

const queue = () => withGroupQueue(ANA, (db) => loadGroupQueue(db));
const queueExpense = (request: ReturnType<typeof expenseEdit>) =>
  withGroupQueue(ANA, (db) =>
    queueGroupUpdate(db, { kind: 'expense', base: expenseRecord(2), request }),
  );
const queueSettlement = (amount: string) =>
  withGroupQueue(ANA, (db) =>
    queueGroupUpdate(db, { kind: 'settlement', base: settlementRecord(2), request: { amount } }),
  );

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Reflect.deleteProperty(navigator, 'locks');
});

afterEach(() => {
  cancelSyncRetry();
});

describe('a conflict whose server copy already holds the queued edit (SAST L-1)', () => {
  it('settles an identical expense edit, caches the server copy and marks no conflict', async () => {
    await queueExpense(expenseEdit('12000'));

    const outcome = await syncMovementQueue(
      ANA,
      fakeApi({ expense: conflictOf(expenseRecord(3, '12000')) }),
    );

    expect(outcome).toMatchObject({ sent: 1, rejected: 0 });
    expect(outcome?.conflicts).toBeUndefined();
    expect(await queue()).toEqual([]);
    const cached = await withGroupQueue(ANA, (db) => readCachedGroupRecord(db, 'expense', EXPENSE));
    expect(cached).toMatchObject({ version: 3, amount: '12000' });
  });

  it('keeps a real conflict when one field differs', async () => {
    await queueExpense(expenseEdit('12000'));
    const current = { ...expenseRecord(3, '12000'), description: 'lunch' };

    const outcome = await syncMovementQueue(ANA, fakeApi({ expense: conflictOf(current) }));

    expect(outcome).toMatchObject({ sent: 0, conflicts: 1 });
    const [record] = await queue();
    expect(record?.conflict?.server).toMatchObject({ version: 3, description: 'lunch' });
  });

  it('keeps a real conflict when only the split differs', async () => {
    await queueExpense(expenseEdit('12000'));
    const current: GroupExpenseResponse = {
      ...expenseRecord(3, '12000'),
      splitMode: 'exact',
      shares: [
        { memberId: MEMBER_A, amount: '8000' },
        { memberId: MEMBER_B, amount: '4000' },
      ],
    };

    const outcome = await syncMovementQueue(ANA, fakeApi({ expense: conflictOf(current) }));

    expect(outcome).toMatchObject({ sent: 0, conflicts: 1 });
    expect((await queue())[0]?.conflict).toBeDefined();
  });

  it('settles an identical settlement edit', async () => {
    await queueSettlement('3000');

    const outcome = await syncMovementQueue(
      ANA,
      fakeApi({ settlement: conflictOf(settlementRecord(3, '3000')) }),
    );

    expect(outcome).toMatchObject({ sent: 1, rejected: 0 });
    expect(await queue()).toEqual([]);
  });

  it('keeps a settlement conflict when the amount differs', async () => {
    await queueSettlement('3000');

    const outcome = await syncMovementQueue(
      ANA,
      fakeApi({ settlement: conflictOf(settlementRecord(3, '9999')) }),
    );

    expect(outcome).toMatchObject({ sent: 0, conflicts: 1 });
  });

  it('leaves a delete conflict as a conflict', async () => {
    await withGroupQueue(ANA, (db) =>
      queueGroupDelete(db, { kind: 'expense', base: expenseRecord(2) }),
    );

    const outcome = await syncMovementQueue(
      ANA,
      fakeApi({ removeExpense: conflictOf(expenseRecord(3)) }),
    );

    expect(outcome).toMatchObject({ sent: 0, conflicts: 1 });
    expect((await queue())[0]?.conflict).toBeDefined();
  });
});
