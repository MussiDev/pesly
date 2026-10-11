// @vitest-environment happy-dom
import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGroupChanges } from '../src/features/groups/edit/use-group-changes';
import { openLocalDatabase } from '../src/lib/local-store/database';
import {
  loadGroupQueue,
  markGroupRejected,
  queueGroupUpdate,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { MOVEMENT_QUEUED_EVENT, QUEUE_CHANGED_EVENT } from '../src/lib/sync/sync-events';

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const OTHER_GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expense(version = 1, amount = '10000', groupId = GROUP): GroupExpenseResponse {
  return {
    id: EXPENSE,
    groupId,
    payerMemberId: MEMBER_A,
    createdByMemberId: MEMBER_A,
    amount,
    currency: 'ARS',
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'Cena',
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

function settlement(): SettlementResponse {
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
    version: 1,
  };
}

function expenseRequest(amount: string) {
  return {
    amount,
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'Cena',
    split: { mode: 'equal' as const, memberIds: [MEMBER_A, MEMBER_B] },
  };
}

async function readQueue() {
  return withGroupQueue(ANA, (database) => loadGroupQueue(database));
}

function events() {
  const queued = vi.fn();
  const changed = vi.fn();
  window.addEventListener(MOVEMENT_QUEUED_EVENT, queued);
  window.addEventListener(QUEUE_CHANGED_EVENT, changed);
  return { queued, changed };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: ANA, emailVerified: true });
});

describe('useGroupChanges (DISC-001-05h Block 4)', () => {
  it('queueUpdate stores one update based on the loaded record and asks for a pass', async () => {
    const spy = events();
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    let stored = false;
    await act(async () => {
      stored = await result.current.queueUpdate({
        kind: 'expense',
        base: expense(),
        request: expenseRequest('12000'),
      });
    });

    expect(stored).toBe(true);
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operation: 'update', base: expense() });
    expect(spy.queued).toHaveBeenCalledTimes(1);
    expect(spy.changed).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.changes).toHaveLength(1);
    });
  });

  it('queueUpdate reports a failure and stores nothing when the request is invalid', async () => {
    const spy = events();
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    let stored = true;
    await act(async () => {
      stored = await result.current.queueUpdate({
        kind: 'expense',
        base: expense(),
        request: expenseRequest('0'),
      });
    });

    expect(stored).toBe(false);
    expect(await readQueue()).toHaveLength(0);
    expect(spy.queued).not.toHaveBeenCalled();
  });

  it('queueDelete stores a delete with the loaded record as base and asks for a pass', async () => {
    const spy = events();
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      await result.current.queueDelete({ kind: 'settlement', base: settlement() });
    });
    // A double click is harmless.
    await act(async () => {
      await result.current.queueDelete({ kind: 'settlement', base: settlement() });
    });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operation: 'delete', base: settlement() });
    expect(spy.queued).toHaveBeenCalled();
  });

  it('stores nothing when nobody calls queueDelete (cancelled confirmation)', async () => {
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(await readQueue()).toHaveLength(0);
    expect(result.current.changes).toEqual([]);
  });

  it('retry clears the rejection and asks for a pass; discard removes the change', async () => {
    await withGroupQueue(ANA, async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(),
        request: expenseRequest('12000'),
      });
      await markGroupRejected(database, 'expense', EXPENSE, 'GROUP_RECORD_EDIT_FORBIDDEN');
    });
    const spy = events();
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.changes[0]?.rejection?.code).toBe('GROUP_RECORD_EDIT_FORBIDDEN');
    });

    await act(async () => {
      await result.current.retry('expense', EXPENSE);
    });
    expect((await readQueue())[0]?.rejection).toBeUndefined();
    expect(spy.queued).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.changes[0]?.rejection).toBeUndefined();
    });

    await act(async () => {
      await result.current.discard('expense', EXPENSE);
    });
    expect(await readQueue()).toHaveLength(0);
    // Discarding asks for no pass: there is nothing left to send.
    expect(spy.queued).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.changes).toEqual([]);
    });
  });

  it('keeps only the changes of its own group', async () => {
    await withGroupQueue(ANA, (database) =>
      queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(),
        request: expenseRequest('12000'),
      }),
    );
    const other = renderHook(() => useGroupChanges(OTHER_GROUP));
    await waitFor(() => {
      expect(other.result.current.ready).toBe(true);
    });
    expect(other.result.current.changes).toEqual([]);

    const mine = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(mine.result.current.changes).toHaveLength(1);
    });
  });

  it('re-reads the queue when onQueueChanged fires', async () => {
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    await withGroupQueue(ANA, (database) =>
      queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(),
        request: expenseRequest('12000'),
      }),
    );
    act(() => {
      window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    });
    await waitFor(() => {
      expect(result.current.changes).toHaveLength(1);
    });
  });

  it('is not available without a session pointer and sends no API request', async () => {
    localStorage.clear();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.available).toBe(false);

    let stored = true;
    await act(async () => {
      stored = await result.current.queueUpdate({
        kind: 'expense',
        base: expense(),
        request: expenseRequest('12000'),
      });
    });
    expect(stored).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is not available when the store cannot be opened', async () => {
    const failing = new IDBFactory();
    failing.open = () => {
      throw new Error('blocked');
    };
    globalThis.indexedDB = failing;
    const { result } = renderHook(() => useGroupChanges(GROUP));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.available).toBe(false);
  });

  it('queues 1,000 random amounts and reads each back equal as a string', async () => {
    let state = 88172645463325252n;
    const next = (): bigint => {
      state ^= (state << 13n) & 0xffffffffffffffffn;
      state ^= state >> 7n;
      state ^= (state << 17n) & 0xffffffffffffffffn;
      return state;
    };
    const database = await openLocalDatabase(ANA);
    try {
      for (let run = 0; run < 1000; run += 1) {
        const amount = (1n + (next() % 99_999_999_999_999n)).toString();
        await queueGroupUpdate(database, {
          kind: 'expense',
          base: expense(1, '1'),
          request: expenseRequest(amount),
        });
        const queue = await loadGroupQueue(database);
        const request = queue[0]?.request;
        expect(request !== undefined && 'amount' in request ? request.amount : undefined).toBe(
          amount,
        );
      }
    } finally {
      database.close();
    }
  });
});
