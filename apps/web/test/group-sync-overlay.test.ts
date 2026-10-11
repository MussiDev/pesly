import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import type { QueuedGroupChange } from '../src/lib/local-store/group-queue';
import { groupSyncState, overlayGroupRecords } from '../src/features/groups/sync-overlay';

const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function expense(n: number, version: number, amount = '10000'): GroupExpenseResponse {
  return {
    id: id(n),
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

function settlement(n: number, version: number): SettlementResponse {
  return {
    id: id(n),
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

interface ChangeOptions {
  operation?: 'update' | 'delete';
  rejection?: { code: string };
  conflict?: GroupExpenseResponse;
}

function change(n: number, options: ChangeOptions = {}): QueuedGroupChange {
  const operation = options.operation ?? 'update';
  return {
    key: `expense:${id(n)}`,
    kind: 'expense',
    id: id(n),
    groupId: GROUP,
    operation,
    createdAt: '2026-10-05T12:00:00.000Z',
    revision: 1,
    base: expense(n, 2),
    ...(operation === 'update'
      ? {
          request: {
            amount: '12000',
            occurredAt: '2026-10-02T15:30:00.000Z',
            categoryId: CATEGORY,
            description: 'dinner',
            split: { mode: 'equal' as const, memberIds: [MEMBER_A, MEMBER_B] },
          },
        }
      : {}),
    ...(options.rejection === undefined ? {} : { rejection: options.rejection }),
    ...(options.conflict === undefined ? {} : { conflict: { server: options.conflict } }),
  };
}

describe('group sync overlay (DISC-001-04e Block 7)', () => {
  it('shows a row with no queued change as synced (AC-03)', () => {
    const rows = overlayGroupRecords('expense', [expense(1, 2)], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ syncState: 'synced' });
    expect(rows[0]?.failure).toBeUndefined();
  });

  it('shows conflict for a record in conflict and carries the server copy (AC-05)', () => {
    const queue = [change(1, { conflict: expense(1, 3, '9999') })];

    const [row] = overlayGroupRecords('expense', [expense(1, 2)], queue);

    expect(row?.syncState).toBe('conflict');
    expect(row?.server).toMatchObject({ version: 3, amount: '9999' });
    expect(groupSyncState('expense', id(1), queue)).toBe('conflict');
  });

  it('shows failed with the operation and code for a rejected change', () => {
    const queue = [change(1, { rejection: { code: 'NOT_FOUND' } })];

    const [row] = overlayGroupRecords('expense', [expense(1, 2)], queue);

    expect(row).toMatchObject({
      syncState: 'failed',
      failure: { operation: 'update', code: 'NOT_FOUND' },
    });
  });

  it('shows pending for a queued edit, and synced once keepServer emptied the queue (AC-03)', () => {
    expect(groupSyncState('expense', id(1), [change(1)])).toBe('pending');
    expect(groupSyncState('expense', id(1), [])).toBe('synced');
  });

  it('shows pending after keepMine: the conflict is cleared and the change is queued again (AC-03)', () => {
    const [row] = overlayGroupRecords('expense', [expense(1, 3)], [change(1)]);

    expect(row?.syncState).toBe('pending');
    expect(row?.server).toBeUndefined();
  });

  it('hides a pending delete and shows a rejected delete as failed', () => {
    const hidden = overlayGroupRecords(
      'expense',
      [expense(1, 2)],
      [change(1, { operation: 'delete' })],
    );
    const failed = overlayGroupRecords(
      'expense',
      [expense(1, 2)],
      [change(1, { operation: 'delete', rejection: { code: 'FORBIDDEN' } })],
    );

    expect(hidden).toEqual([]);
    expect(failed[0]).toMatchObject({ syncState: 'failed', failure: { operation: 'delete' } });
  });

  it('keeps expenses and settlements apart even when the ids are equal', () => {
    const queue = [change(1, { rejection: { code: 'FORBIDDEN' } })];

    const [row] = overlayGroupRecords('settlement', [settlement(1, 1)], queue);

    expect(row?.syncState).toBe('synced');
    expect(groupSyncState('settlement', id(1), queue)).toBe('synced');
  });

  it('leaves the rows of other records untouched and in order', () => {
    const rows = overlayGroupRecords(
      'expense',
      [expense(1, 2), expense(2, 1)],
      [change(2, { conflict: expense(2, 2) })],
    );

    expect(rows.map((row) => [row.record.id, row.syncState])).toEqual([
      [id(1), 'synced'],
      [id(2), 'conflict'],
    ]);
  });
});
