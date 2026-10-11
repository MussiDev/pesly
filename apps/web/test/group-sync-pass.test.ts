import type { GroupExpenseResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import type { ApiFailure, ApiResult } from '../src/lib/api-client';
import type { QueuedGroupChange } from '../src/lib/local-store/group-queue';
import { runGroupSyncPass, runSyncPass } from '../src/lib/sync/sync-pass';

const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function expense(n: number, version: number): GroupExpenseResponse {
  return {
    id: id(n),
    groupId: GROUP,
    payerMemberId: MEMBER_A,
    createdByMemberId: MEMBER_A,
    amount: '10000',
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

function queued(n: number, flag?: 'rejection' | 'conflict'): QueuedGroupChange {
  return {
    key: `expense:${id(n)}`,
    kind: 'expense',
    id: id(n),
    groupId: GROUP,
    operation: 'delete',
    createdAt: new Date(Date.UTC(2026, 9, 5, 12, 0, 0, n)).toISOString(),
    revision: 1,
    base: expense(n, 2),
    ...(flag === 'rejection' ? { rejection: { code: 'FORBIDDEN' } } : {}),
    ...(flag === 'conflict' ? { conflict: { server: expense(n, 3) } } : {}),
  };
}

const ok: ApiResult<unknown> = { ok: true, data: {} };

function failure(code: ApiFailure['code']): ApiFailure {
  return { ok: false, code, messageKey: code === 'NETWORK' ? 'network' : 'unexpected' };
}

const conflict: ApiResult<unknown> = {
  ...failure('GROUP_RECORD_CONFLICT'),
  current: expense(1, 3),
};

function recorder() {
  const log = {
    sent: [] as string[],
    rejected: [] as [string, string][],
    conflicts: [] as string[],
  };
  return {
    log,
    onSent: (item: QueuedGroupChange) => {
      log.sent.push(item.id);
    },
    onRejected: (item: QueuedGroupChange, code: string) => {
      log.rejected.push([item.id, code]);
    },
    onConflict: (item: QueuedGroupChange) => {
      log.conflicts.push(item.id);
    },
  };
}

describe('runGroupSyncPass (DISC-001-04e Block 7)', () => {
  it('skips records already rejected or in conflict: a conflict is never retried (FR-01)', async () => {
    const calls: string[] = [];

    const outcome = await runGroupSyncPass({
      items: [queued(1, 'conflict'), queued(2, 'rejection'), queued(3)],
      send: (item) => {
        calls.push(item.id);
        return Promise.resolve(ok);
      },
      ...recorder(),
    });

    expect(calls).toEqual([id(3)]);
    expect(outcome).toEqual({ sent: 1, rejected: 0, conflicts: 0 });
  });

  it('stores a conflict answer, counts it apart from rejections and goes on (AC-01)', async () => {
    const r = recorder();

    const outcome = await runGroupSyncPass({
      items: [queued(1), queued(2), queued(3)],
      send: (item) => Promise.resolve(item.id === id(1) ? conflict : ok),
      ...r,
    });

    expect(outcome).toEqual({ sent: 2, rejected: 0, conflicts: 1 });
    expect(r.log.conflicts).toEqual([id(1)]);
    expect(r.log.sent.sort()).toEqual([id(2), id(3)]);
  });

  it('rejects any other refusal and keeps the stop-by-code rules', async () => {
    const r = recorder();
    const refused = await runGroupSyncPass({
      items: [queued(1)],
      send: () => Promise.resolve(failure('GROUP_RECORD_EDIT_FORBIDDEN')),
      ...r,
    });
    const offline = await runGroupSyncPass({
      items: [queued(1), queued(2)],
      send: () => Promise.resolve(failure('NETWORK')),
      concurrency: 1,
      ...r,
    });

    expect(refused).toMatchObject({ rejected: 1, conflicts: 0 });
    expect(r.log.rejected).toEqual([[id(1), 'GROUP_RECORD_EDIT_FORBIDDEN']]);
    expect(offline).toMatchObject({ stopped: 'offline', sent: 0, rejected: 0 });
  });

  it('treats a conflict code without the server record as a plain refusal', async () => {
    const outcome = await runGroupSyncPass({
      items: [queued(1)],
      send: () => Promise.resolve(failure('GROUP_RECORD_CONFLICT')),
      ...recorder(),
    });

    expect(outcome).toMatchObject({ rejected: 1, conflicts: 0 });
  });

  it('leaves the movement pass without a conflicts field', async () => {
    const outcome = await runSyncPass({
      items: [],
      send: () => Promise.resolve(ok),
      onSent: () => undefined,
      onRejected: () => undefined,
    });

    expect(outcome).toEqual({ sent: 0, rejected: 0 });
  });
});
