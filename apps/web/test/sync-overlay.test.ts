import type { MovementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { overlayQueue } from '../src/features/movements/sync-overlay';
import { changeToMovement, type QueuedMovement } from '../src/lib/local-store/queue';

const ACCOUNT = '00000000-0000-4000-8000-000000000900';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000903';
const CATEGORY = '00000000-0000-4000-8000-000000000901';
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = (d: number): string => `2026-10-${String(d).padStart(2, '0')}T10:00:00.000Z`;

function server(n: number, occurredAt = day(n)): MovementResponse {
  return {
    id: id(n),
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    destinationAccountId: null,
    amount: '100000',
    destinationAmount: null,
    occurredAt,
    note: 'server note',
    rate: '13000000',
    rateSource: 'automatic',
    rateType: 'blue',
    tags: ['old'],
    createdAt: occurredAt,
  };
}

type Rate = { source: 'keep' } | { source: 'automatic' } | { source: 'manual'; value: string };

function update(n: number, rate: Rate = { source: 'keep' }, rejection?: string): QueuedMovement {
  return {
    operation: 'update',
    id: id(n),
    revision: 1,
    createdAt: day(20),
    base: server(n),
    request: {
      type: 'expense',
      accountId: OTHER_ACCOUNT,
      categoryId: CATEGORY,
      amount: '250000',
      occurredAt: day(n),
      note: 'edited',
      tags: ['new'],
      rate,
    },
    ...(rejection === undefined ? {} : { rejection: { code: rejection } }),
  };
}

function remove(n: number, rejection?: string): QueuedMovement {
  return {
    operation: 'delete',
    id: id(n),
    revision: 1,
    createdAt: day(20),
    base: server(n),
    ...(rejection === undefined ? {} : { rejection: { code: rejection } }),
  };
}

function create(n: number, rejection?: string): QueuedMovement {
  return {
    operation: 'create',
    id: id(n),
    revision: 1,
    createdAt: day(20),
    request: {
      id: id(n),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '5000',
      occurredAt: day(n),
      rate: { source: 'manual', value: '14000000' },
    },
    ...(rejection === undefined ? {} : { rejection: { code: rejection } }),
  };
}

const all = { includeUnlisted: true };

describe('a queued edit as a list row', () => {
  it('keeps the base rate for keep, shows the typed rate for manual and no rate for automatic (AC-01)', () => {
    expect(changeToMovement(update(1))).toMatchObject({
      rate: '13000000',
      rateSource: 'automatic',
      rateType: 'blue',
    });
    expect(changeToMovement(update(1, { source: 'manual', value: '15000000' }))).toMatchObject({
      rate: '15000000',
      rateSource: 'manual',
      rateType: null,
    });
    expect(changeToMovement(update(1, { source: 'automatic' }))).toMatchObject({
      rate: null,
      rateSource: 'automatic',
      rateType: null,
    });
  });

  it('shows the base of a delete, and the request of a create (AC-01)', () => {
    expect(changeToMovement(remove(1))).toEqual(server(1));
    expect(changeToMovement(create(2))).toMatchObject({ id: id(2), amount: '5000' });
  });

  it('shows the edited transfer and exchange fields over their base (AC-01)', () => {
    const transferBase: MovementResponse = {
      ...server(3),
      type: 'transfer',
      categoryId: null,
      destinationAccountId: OTHER_ACCOUNT,
      destinationAmount: '100000',
      rate: null,
      rateSource: null,
      rateType: null,
      tags: [],
    };
    const transfer: QueuedMovement = {
      operation: 'update',
      id: id(3),
      revision: 1,
      createdAt: day(20),
      base: transferBase,
      request: {
        type: 'transfer',
        accountId: ACCOUNT,
        destinationAccountId: OTHER_ACCOUNT,
        amount: '700',
        occurredAt: day(3),
      },
    };
    expect(changeToMovement(transfer)).toMatchObject({
      amount: '700',
      destinationAmount: '700',
      note: null,
      tags: [],
    });

    const exchange: QueuedMovement = {
      ...transfer,
      base: { ...transferBase, type: 'exchange', rateSource: 'implied', rate: '14000000' },
      request: {
        type: 'exchange',
        accountId: ACCOUNT,
        destinationAccountId: OTHER_ACCOUNT,
        amount: '1450000',
        destinationAmount: '1000',
        occurredAt: day(3),
      },
    };
    const currencies = new Map([
      [ACCOUNT, 'ARS'],
      [OTHER_ACCOUNT, 'USD'],
    ]);
    expect(changeToMovement(exchange, currencies)).toMatchObject({
      destinationAmount: '1000',
      rate: '14500000',
      rateSource: 'implied',
    });
  });

  it('shows the base when the request type differs from it (invalid input)', () => {
    const mismatched: QueuedMovement = {
      operation: 'update',
      id: id(1),
      revision: 1,
      createdAt: day(20),
      base: server(1),
      request: {
        type: 'transfer',
        accountId: ACCOUNT,
        destinationAccountId: OTHER_ACCOUNT,
        amount: '1',
        occurredAt: day(1),
      },
    };

    expect(changeToMovement(mismatched)).toEqual(server(1));
  });
});

describe('overlay of the queue on the loaded rows', () => {
  it('shows a page row with a pending edit with the edited values, as pending (AC-01)', () => {
    const [row] = overlayQueue([server(1)], [update(1)], all);

    expect(row?.syncState).toBe('pending');
    expect(row?.movement).toMatchObject({
      id: id(1),
      accountId: OTHER_ACCOUNT,
      amount: '250000',
      note: 'edited',
      tags: ['new'],
    });
  });

  it('leaves out a page row with a pending delete (AC-01)', () => {
    expect(
      overlayQueue([server(1), server(2)], [remove(1)], all).map((row) => row.movement.id),
    ).toEqual([id(2)]);
  });

  it('marks rows synced, pending or failed with the rejection code (AC-02)', () => {
    const rows = overlayQueue(
      [server(3), server(2), server(1)],
      [update(2), update(1, { source: 'keep' }, 'ACCOUNT_ARCHIVED')],
      all,
    );

    expect(rows.map((row) => [row.movement.id, row.syncState, row.failure])).toEqual([
      [id(3), 'synced', undefined],
      [id(2), 'pending', undefined],
      [id(1), 'failed', { operation: 'update', code: 'ACCOUNT_ARCHIVED' }],
    ]);
  });

  it('shows a failed delete as its base row, failed (AC-05)', () => {
    const [row] = overlayQueue([server(1)], [remove(1, 'INVALID')], all);

    expect(row).toEqual({
      movement: server(1),
      syncState: 'failed',
      failure: { operation: 'delete', code: 'INVALID' },
    });
  });

  it('adds a queued create that is not in the page, by date, only when unlisted rows are wanted (AC-02)', () => {
    const page = [server(5), server(1)];

    expect(
      overlayQueue(page, [create(3)], all).map((row) => [row.movement.id, row.syncState]),
    ).toEqual([
      [id(5), 'synced'],
      [id(3), 'pending'],
      [id(1), 'synced'],
    ]);
    expect(overlayQueue(page, [create(3)], { includeUnlisted: false })).toHaveLength(2);
  });

  it('adds an edit of a movement beyond the page and a failed delete, but never a pending delete (AC-02)', () => {
    const rows = overlayQueue([], [update(4), remove(3, 'INVALID'), remove(2)], all);

    expect(rows.map((row) => [row.movement.id, row.syncState])).toEqual([
      [id(4), 'pending'],
      [id(3), 'failed'],
    ]);
  });

  it('shows a page row once when its create is still queued, as pending (FR-02)', () => {
    const rows = overlayQueue([server(1)], [create(1)], all);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.syncState).toBe('pending');
  });
});
