// @vitest-environment happy-dom
import type { GroupExpenseResponse } from '@pesly/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGroupChanges } from '../src/features/groups/edit/use-group-changes';
import {
  keepMine,
  keepServer,
  markGroupConflict,
  queueGroupUpdate,
  readCachedGroupRecord,
  readGroupChange,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { QUEUE_CHANGED_EVENT } from '../src/lib/sync/sync-events';

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expense(version: number, amount: string): GroupExpenseResponse {
  return {
    id: EXPENSE,
    groupId: GROUP,
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

async function queueConflict(): Promise<void> {
  await withGroupQueue(ANA, async (database) => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expense(2, '10000'),
      request: {
        amount: '12000',
        occurredAt: '2026-10-02T15:30:00.000Z',
        categoryId: CATEGORY,
        description: 'Cena',
        split: { mode: 'equal', memberIds: [MEMBER_A, MEMBER_B] },
      },
    });
    await markGroupConflict(database, 'expense', EXPENSE, 1, expense(3, '15000'));
  });
}

async function snapshot() {
  return withGroupQueue(ANA, async (database) => ({
    change: await readGroupChange(database, 'expense', EXPENSE),
    cached: await readCachedGroupRecord(database, 'expense', EXPENSE),
  }));
}

async function shownByHook() {
  const { result } = renderHook(() => useGroupChanges(GROUP));
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return result.current.changes;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: ANA, emailVerified: true });
});

describe('interrupted conflict resolutions (DISC-001-05h Block 4, NFR-05)', () => {
  it.each([
    ['keepMine', keepMine],
    ['keepServer', keepServer],
  ] as const)(
    'an interrupted %s leaves the queued change and the server copy as they were',
    async (_name, choose) => {
      await queueConflict();
      const before = await snapshot();

      for (const interruptAt of [0, 1]) {
        await expect(
          withGroupQueue(ANA, (database) =>
            choose(database, 'expense', EXPENSE, {
              onStep: (step, abort) => {
                if (step === interruptAt) abort();
              },
            }),
          ),
        ).rejects.toBeTruthy();
        expect(await snapshot()).toEqual(before);
      }

      await waitFor(async () => {
        const changes = await shownByHook();
        expect(changes).toHaveLength(1);
        expect(changes[0]?.conflict?.server).toEqual(expense(3, '15000'));
        expect(changes[0]?.request).toMatchObject({ amount: '12000' });
      });
    },
  );

  it('a completed choice keeps the surviving version', async () => {
    await queueConflict();
    await withGroupQueue(ANA, (database) => keepServer(database, 'expense', EXPENSE));
    expect(await snapshot()).toEqual({ change: undefined, cached: expense(3, '15000') });
    expect(await shownByHook()).toEqual([]);

    globalThis.indexedDB = new IDBFactory();
    await queueConflict();
    await withGroupQueue(ANA, (database) => keepMine(database, 'expense', EXPENSE));
    const { change } = await snapshot();
    expect(change?.conflict).toBeUndefined();
    expect(change?.base).toEqual(expense(3, '15000'));
    expect(change?.request).toMatchObject({ amount: '12000' });
  });
});
