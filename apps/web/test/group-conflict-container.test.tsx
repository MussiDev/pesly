// @vitest-environment happy-dom
import type { GroupExpenseResponse, GroupSplit, SettlementResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupConflictContainer } from '../src/features/groups/containers/group-conflict-container';
import { openLocalDatabase } from '../src/lib/local-store/database';
import {
  discardGroupChange,
  markGroupConflict,
  queueGroupDelete,
  queueGroupUpdate,
  readCachedGroupRecord,
  readGroupChange,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { CATALOGS, renderApp } from './support/render-app';

const copy = CATALOGS.es.groupConflict;

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expense(version: number, amount: string, description = 'Cena'): GroupExpenseResponse {
  return {
    id: EXPENSE,
    groupId: GROUP,
    payerMemberId: MEMBER_A,
    createdByMemberId: MEMBER_A,
    amount,
    currency: 'ARS',
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description,
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

function settlement(version: number, amount: string): SettlementResponse {
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

async function withDatabase<T>(work: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openLocalDatabase(ANA);
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

/** An expense edited here (12000) while the server moved on to version 3 (15000). */
async function queueExpenseConflict(): Promise<void> {
  await withDatabase(async (database) => {
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
    await markGroupConflict(
      database,
      'expense',
      EXPENSE,
      1,
      expense(3, '15000', 'Cena con postre'),
    );
  });
}

const names = {
  memberNames: { [MEMBER_A]: 'Ana', [MEMBER_B]: 'Beto' },
  categoryNames: { [CATEGORY]: 'Comida' },
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: ANA, emailVerified: true });
});

describe('GroupConflictContainer (DISC-001-04e Block 8)', () => {
  it('loads the record and shows both versions with locale-formatted amounts', async () => {
    await queueExpenseConflict();

    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} {...names} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    const server = screen.getByRole('region', { name: copy.server });
    expect(within(mine).getByText(/120,00/)).toBeTruthy();
    expect(within(server).getByText(/150,00/)).toBeTruthy();
    expect(within(server).getByText('Cena con postre')).toBeTruthy();
    expect(within(mine).getByText('Comida')).toBeTruthy();
    expect(within(mine).getByText(/Beto/)).toBeTruthy();
  });

  it('shows a settlement with amount and date only', async () => {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(1, '2500'),
        request: { amount: '2600' },
      });
      await markGroupConflict(database, 'settlement', SETTLEMENT, 1, settlement(2, '3000'));
    });

    renderApp(<GroupConflictContainer kind="settlement" id={SETTLEMENT} {...names} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText(/26,00/)).toBeTruthy();
    expect(within(mine).queryByText(copy.fields.category)).toBeNull();
    expect(
      within(screen.getByRole('region', { name: copy.server })).getByText(/30,00/),
    ).toBeTruthy();
  });

  it('"Keep mine" rebases the change on the server version and requests a sync pass', async () => {
    await queueExpenseConflict();
    const requestSync = vi.fn();
    const onResolved = vi.fn();
    renderApp(
      <GroupConflictContainer
        kind="expense"
        id={EXPENSE}
        {...names}
        requestSync={requestSync}
        onResolved={onResolved}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: copy.keepMine }));

    await waitFor(() => {
      expect(requestSync).toHaveBeenCalledTimes(1);
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    const record = await withDatabase((database) => readGroupChange(database, 'expense', EXPENSE));
    expect(record?.conflict).toBeUndefined();
    expect(record?.base.version).toBe(3);
    expect(record?.operation === 'update' && record.request?.amount).toBe('12000');
  });

  it('"Keep server\'s" drops the local change and stores the server copy', async () => {
    await queueExpenseConflict();
    const requestSync = vi.fn();
    const onResolved = vi.fn();
    renderApp(
      <GroupConflictContainer
        kind="expense"
        id={EXPENSE}
        {...names}
        requestSync={requestSync}
        onResolved={onResolved}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: copy.keepServer }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    expect(requestSync).not.toHaveBeenCalled();
    await withDatabase(async (database) => {
      expect(await readGroupChange(database, 'expense', EXPENSE)).toBeUndefined();
      expect(await readCachedGroupRecord(database, 'expense', EXPENSE)).toMatchObject({
        version: 3,
        amount: '15000',
      });
    });
  });

  it('renders nothing and reports it when the record has no conflict', async () => {
    await withDatabase((database) =>
      queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(2, '10000'),
        request: {
          amount: '12000',
          occurredAt: '2026-10-02T15:30:00.000Z',
          categoryId: CATEGORY,
          description: 'Cena',
          split: { mode: 'equal', memberIds: [MEMBER_A] },
        },
      }),
    );
    const onNoConflict = vi.fn();

    const { container } = renderApp(
      <GroupConflictContainer kind="expense" id={EXPENSE} onNoConflict={onNoConflict} />,
    );

    await waitFor(() => {
      expect(onNoConflict).toHaveBeenCalledTimes(1);
    });
    expect(container.textContent).toBe('');
  });

  it('renders nothing and reports it when the record is not queued', async () => {
    const onNoConflict = vi.fn();

    const { container } = renderApp(
      <GroupConflictContainer kind="settlement" id={SETTLEMENT} onNoConflict={onNoConflict} />,
    );

    await waitFor(() => {
      expect(onNoConflict).toHaveBeenCalledTimes(1);
    });
    expect(container.textContent).toBe('');
  });

  it('renders nothing and reports it when there is no signed-in user on the device', async () => {
    localStorage.clear();
    const onNoConflict = vi.fn();

    const { container } = renderApp(
      <GroupConflictContainer kind="expense" id={EXPENSE} onNoConflict={onNoConflict} />,
    );

    await waitFor(() => {
      expect(onNoConflict).toHaveBeenCalledTimes(1);
    });
    expect(container.textContent).toBe('');
  });

  it('shows an error and keeps both versions when the resolution is rejected', async () => {
    await queueExpenseConflict();
    const requestSync = vi.fn();
    const onResolved = vi.fn();
    renderApp(
      <GroupConflictContainer
        kind="expense"
        id={EXPENSE}
        {...names}
        requestSync={requestSync}
        onResolved={onResolved}
      />,
    );
    const keepMine = await screen.findByRole('button', { name: copy.keepMine });
    // The record disappears between rendering and the click: the resolution is refused.
    await withDatabase((database) => discardGroupChange(database, 'expense', EXPENSE));

    await userEvent.click(keepMine);

    expect((await screen.findByRole('alert')).textContent).toContain(copy.error);
    expect(screen.getByRole('region', { name: copy.mine })).toBeTruthy();
    expect(screen.getByRole('region', { name: copy.server })).toBeTruthy();
    expect(requestSync).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.keepMine }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('shows a queued deletion as deleted on the mine side', async () => {
    await withDatabase(async (database) => {
      await queueGroupDelete(database, { kind: 'expense', base: expense(2, '10000') });
      await markGroupConflict(database, 'expense', EXPENSE, 1, expense(3, '15000'));
    });

    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} {...names} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText(copy.deleted)).toBeTruthy();
  });

  it('dispatches the default sync request event when none is injected', async () => {
    await queueExpenseConflict();
    const heard = vi.fn();
    window.addEventListener('pesly:movement-queued', heard);
    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} {...names} />);

    await userEvent.click(await screen.findByRole('button', { name: copy.keepMine }));

    await waitFor(() => {
      expect(heard).toHaveBeenCalled();
    });
    window.removeEventListener('pesly:movement-queued', heard);
  });

  async function queueSplit(split: GroupSplit): Promise<void> {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(2, '10000'),
        request: {
          amount: '10000',
          occurredAt: '2026-10-02T15:30:00.000Z',
          categoryId: CATEGORY,
          description: 'Cena',
          split,
        },
      });
      await markGroupConflict(database, 'expense', EXPENSE, 1, expense(3, '15000'));
    });
  }

  it('previews a percentage split in amounts, with unknown names when none are given', async () => {
    await queueSplit({
      mode: 'percentage',
      shares: [
        { memberId: MEMBER_B, basisPoints: 2500 },
        { memberId: MEMBER_A, basisPoints: 7500 },
      ],
    });

    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} />, { locale: 'en' });

    const mine = await screen.findByRole('region', { name: CATALOGS.en.groupConflict.mine });
    expect(within(mine).getByText(/Percentages/)).toBeTruthy();
    expect(within(mine).getAllByText(/Unknown member/)).toHaveLength(2);
    expect(within(mine).getByText(/75\.00/)).toBeTruthy();
    expect(within(mine).getByText(/Unknown category/)).toBeTruthy();
  });

  it('previews an exact split with the amounts as typed', async () => {
    await queueSplit({
      mode: 'exact',
      shares: [
        { memberId: MEMBER_A, amount: '9000' },
        { memberId: MEMBER_B, amount: '1000' },
      ],
    });

    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} {...names} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText(/Ana · 90,00/)).toBeTruthy();
    expect(within(mine).getByText(/Beto · 10,00/)).toBeTruthy();
  });

  it('lists the members of a split that does not add up, without amounts', async () => {
    await queueSplit({
      mode: 'percentage',
      shares: [
        { memberId: MEMBER_A, basisPoints: 100 },
        { memberId: MEMBER_B, basisPoints: 100 },
      ],
    });

    renderApp(<GroupConflictContainer kind="expense" id={EXPENSE} {...names} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText('Ana')).toBeTruthy();
    expect(within(mine).getByText('Beto')).toBeTruthy();
  });

  it('shows a queued settlement deletion as deleted on the mine side', async () => {
    await withDatabase(async (database) => {
      await queueGroupDelete(database, { kind: 'settlement', base: settlement(1, '2500') });
      await markGroupConflict(database, 'settlement', SETTLEMENT, 1, settlement(2, '3000'));
    });

    renderApp(<GroupConflictContainer kind="settlement" id={SETTLEMENT} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText(copy.deleted)).toBeTruthy();
  });

  it('uses the date of a settlement edit that changes only the date', async () => {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(1, '2500'),
        request: { occurredAt: '2026-10-04T10:00:00.000Z' },
      });
      await markGroupConflict(database, 'settlement', SETTLEMENT, 1, settlement(2, '2500'));
    });

    renderApp(<GroupConflictContainer kind="settlement" id={SETTLEMENT} />);

    const mine = await screen.findByRole('region', { name: copy.mine });
    expect(within(mine).getByText(/25,00/)).toBeTruthy();
    expect(within(mine).getByText(/4 oct 2026/)).toBeTruthy();
  });

  it('ignores a load that finishes after the screen is gone', async () => {
    await queueExpenseConflict();
    const onNoConflict = vi.fn();

    const { unmount } = renderApp(
      <GroupConflictContainer kind="expense" id={EXPENSE} onNoConflict={onNoConflict} />,
    );
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onNoConflict).not.toHaveBeenCalled();
  });
});
