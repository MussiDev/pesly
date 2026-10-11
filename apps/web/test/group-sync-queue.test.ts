// @vitest-environment happy-dom
import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiFailure, ApiResult } from '../src/lib/api-client';
import {
  keepMine,
  keepServer,
  loadGroupQueue,
  queueGroupDelete,
  queueGroupUpdate,
  readCachedGroupRecord,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { readGroupQueueCounts } from '../src/lib/sync/group-queue-counts';
import { QUEUE_CHANGED_EVENT, SYNC_FINISHED_EVENT } from '../src/lib/sync/sync-events';
import { cancelSyncRetry, syncMovementQueue } from '../src/lib/sync/sync-queue';

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expenseRecord(version: number, amount = '10000'): GroupExpenseResponse {
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
      { memberId: MEMBER_A, amount: '5000' },
      { memberId: MEMBER_B, amount: '5000' },
    ],
    version,
  };
}

function settlementRecord(version: number): SettlementResponse {
  return {
    id: SETTLEMENT,
    groupId: GROUP,
    fromMemberId: MEMBER_A,
    toMemberId: MEMBER_B,
    currency: 'ARS',
    amount: '2500',
    legs: [{ currency: 'ARS', amount: '2500' }],
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

function expenseEdit(amount: string) {
  return {
    amount,
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'dinner',
    split: { mode: 'equal' as const, memberIds: [MEMBER_A, MEMBER_B] },
  };
}

function failure(code: ApiFailure['code']): ApiFailure {
  return { ok: false, code, messageKey: code === 'NETWORK' ? 'network' : 'unexpected' };
}

const conflictOf = (server: GroupExpenseResponse): ApiResult<never> => ({
  ...failure('GROUP_RECORD_CONFLICT'),
  current: server,
});

type FakeApi = Pick<
  ApiClient,
  | 'createMovement'
  | 'updateMovement'
  | 'deleteMovement'
  | 'updateGroupExpense'
  | 'deleteGroupExpense'
  | 'updateSettlement'
  | 'deleteSettlement'
>;

interface Answers {
  update?: ApiResult<GroupExpenseResponse>;
  remove?: ApiResult<undefined>;
}

function fakeApi(answers: Answers = {}) {
  const calls: { method: string; baseVersion: number | undefined; amount?: string }[] = [];
  const unused = () => Promise.reject(new Error('movement endpoint not expected'));
  const api: FakeApi = {
    createMovement: unused,
    updateMovement: unused,
    deleteMovement: unused,
    updateGroupExpense: (_groupId, _id, body) => {
      calls.push({ method: 'updateExpense', baseVersion: body.baseVersion, amount: body.amount });
      return Promise.resolve(
        answers.update ?? { ok: true, data: expenseRecord(body.baseVersion + 1, body.amount) },
      );
    },
    deleteGroupExpense: (_groupId, _id, baseVersion) => {
      calls.push({ method: 'deleteExpense', baseVersion });
      return Promise.resolve(answers.remove ?? { ok: true, data: undefined });
    },
    updateSettlement: (_groupId, _id, body) => {
      calls.push({ method: 'updateSettlement', baseVersion: body.baseVersion });
      return Promise.resolve({ ok: true, data: settlementRecord(body.baseVersion + 1) });
    },
    deleteSettlement: (_groupId, _id, baseVersion) => {
      calls.push({ method: 'deleteSettlement', baseVersion });
      return Promise.resolve({ ok: true, data: undefined });
    },
  };
  return { api, calls };
}

async function queueEdit(base = expenseRecord(2), amount = '12000'): Promise<void> {
  await withGroupQueue(ANA, (db) =>
    queueGroupUpdate(db, { kind: 'expense', base, request: expenseEdit(amount) }),
  );
}

const queue = () => withGroupQueue(ANA, (db) => loadGroupQueue(db));

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  Reflect.deleteProperty(navigator, 'locks');
});

afterEach(() => {
  cancelSyncRetry();
  vi.useRealTimers();
  setOnline(true);
});

describe('syncMovementQueue with group records (DISC-001-04e Block 7)', () => {
  it('sends a queued edit with the base version of its record and settles it (AC-01)', async () => {
    await queueEdit(expenseRecord(4));
    const { api, calls } = fakeApi();

    const outcome = await syncMovementQueue(ANA, api);

    expect(calls).toEqual([{ method: 'updateExpense', baseVersion: 4, amount: '12000' }]);
    expect(outcome).toMatchObject({ sent: 1, rejected: 0 });
    expect(await queue()).toEqual([]);
  });

  it('writes the server reply to the cache when the edit syncs (AC-03)', async () => {
    await queueEdit(expenseRecord(4));
    const { api } = fakeApi();

    await syncMovementQueue(ANA, api);

    const cached = await withGroupQueue(ANA, (db) => readCachedGroupRecord(db, 'expense', EXPENSE));
    expect(cached).toMatchObject({ version: 5, amount: '12000' });
  });

  it('sends a queued settlement delete with its base version and settles it', async () => {
    await withGroupQueue(ANA, (db) =>
      queueGroupDelete(db, { kind: 'settlement', base: settlementRecord(3) }),
    );
    const { api, calls } = fakeApi();

    await syncMovementQueue(ANA, api);

    expect(calls).toEqual([{ method: 'deleteSettlement', baseVersion: 3 }]);
    expect(await queue()).toEqual([]);
  });

  it('moves a 409 to conflict, keeps the local request and later passes skip it (AC-01)', async () => {
    await queueEdit(expenseRecord(2));
    const first = fakeApi({ update: conflictOf(expenseRecord(3, '9999')) });
    const events: string[] = [];
    window.addEventListener(QUEUE_CHANGED_EVENT, () => events.push('changed'));
    window.addEventListener(SYNC_FINISHED_EVENT, () => events.push('finished'));

    const outcome = await syncMovementQueue(ANA, first.api);
    const second = fakeApi();
    await syncMovementQueue(ANA, second.api);

    expect(outcome).toMatchObject({ sent: 0, rejected: 0, conflicts: 1 });
    expect(second.calls).toEqual([]);
    const [record] = await queue();
    expect(record).toMatchObject({
      request: { amount: '12000' },
      base: { version: 2 },
      conflict: { server: { version: 3, amount: '9999' } },
    });
    expect(record?.rejection).toBeUndefined();
    expect(events).toContain('changed');
    expect(events).not.toContain('finished');
  });

  it('resends a keepMine change with the server version as base (AC-03)', async () => {
    await queueEdit(expenseRecord(2));
    await syncMovementQueue(ANA, fakeApi({ update: conflictOf(expenseRecord(3, '9999')) }).api);
    await withGroupQueue(ANA, (db) => keepMine(db, 'expense', EXPENSE));
    const { api, calls } = fakeApi();

    await syncMovementQueue(ANA, api);

    expect(calls).toEqual([{ method: 'updateExpense', baseVersion: 3, amount: '12000' }]);
    expect(await queue()).toEqual([]);
  });

  it('sends nothing after keepServer: the change is gone (AC-03)', async () => {
    await queueEdit(expenseRecord(2));
    await syncMovementQueue(ANA, fakeApi({ update: conflictOf(expenseRecord(3, '9999')) }).api);
    await withGroupQueue(ANA, (db) => keepServer(db, 'expense', EXPENSE));
    const { api, calls } = fakeApi();

    await syncMovementQueue(ANA, api);

    expect(calls).toEqual([]);
  });

  it('keeps the record queued on a network error and does not mark a conflict', async () => {
    await queueEdit();
    const { api } = fakeApi({ update: failure('NETWORK') });

    const outcome = await syncMovementQueue(ANA, api);

    expect(outcome).toMatchObject({ stopped: 'offline', sent: 0 });
    const [record] = await queue();
    expect(record?.conflict).toBeUndefined();
    expect(record?.rejection).toBeUndefined();
  });

  it('retries a server-error stop with the 04c backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await queueEdit();
    const { api, calls } = fakeApi({ update: failure('INTERNAL') });

    await syncMovementQueue(ANA, api);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });

  it('fails an edit answered 404 with the code the "deleted on another device" message reads', async () => {
    await queueEdit();
    const { api } = fakeApi({ update: failure('NOT_FOUND') });

    const outcome = await syncMovementQueue(ANA, api);

    expect(outcome).toMatchObject({ rejected: 1 });
    const [record] = await queue();
    expect(record).toMatchObject({ operation: 'update', rejection: { code: 'NOT_FOUND' } });
  });

  it('settles a delete answered 404: the record is already gone', async () => {
    await withGroupQueue(ANA, (db) =>
      queueGroupDelete(db, { kind: 'expense', base: expenseRecord(2) }),
    );
    const { api } = fakeApi({ remove: failure('NOT_FOUND') });

    const outcome = await syncMovementQueue(ANA, api);

    expect(outcome).toMatchObject({ sent: 1, rejected: 0 });
    expect(await queue()).toEqual([]);
  });

  it('skips the group queue when the api has no group methods', async () => {
    await queueEdit();
    const unused = () => Promise.reject(new Error('unused'));
    const api = { createMovement: unused, updateMovement: unused, deleteMovement: unused };

    const outcome = await syncMovementQueue(ANA, api);

    expect(outcome).toEqual({ sent: 0, rejected: 0 });
    expect(await queue()).toHaveLength(1);
  });

  it('reads the counts with conflicts apart from failures', async () => {
    await queueEdit();
    await syncMovementQueue(ANA, fakeApi({ update: conflictOf(expenseRecord(3)) }).api);
    await withGroupQueue(ANA, (db) =>
      queueGroupUpdate(db, {
        kind: 'settlement',
        base: settlementRecord(1),
        request: { amount: '100' },
      }),
    );

    expect(await readGroupQueueCounts(ANA)).toEqual({ pending: 1, failed: 0, conflict: 1 });
    expect(await readGroupQueueCounts(undefined)).toEqual({ pending: 0, failed: 0, conflict: 0 });
  });

  it('does not send while offline', async () => {
    await queueEdit();
    setOnline(false);
    const { api, calls } = fakeApi();

    expect(await syncMovementQueue(ANA, api)).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
