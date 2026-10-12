// @vitest-environment happy-dom
import type { SettlementResponse } from '@pesly/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettlementsHistoryContainer } from '../src/features/groups/settlements-history/settlements-history-container';
import { formatMoney } from '../src/lib/format-amount';
import {
  discardGroupChange,
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  queueGroupUpdate,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import {
  MOVEMENT_QUEUED_EVENT,
  notifyQueueChanged,
  notifySyncFinished,
} from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const USER = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '77777777-7777-4777-8777-777777777771';
const BEA = '77777777-7777-4777-8777-777777777772';
const S1 = '88888888-8888-4888-8888-888888888801';
const S2 = '88888888-8888-4888-8888-888888888802';
const money = (value: bigint): string =>
  formatMoney(value, 'ARS', 'en').replaceAll(String.fromCharCode(0xa0), ' ');
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const FIRST_PAGE = `GET /groups/${GROUP_ID}/settlements?limit=50`;
const actions = en.groups.edit.common.actions;

function group(selfMemberId: string, selfRole: 'admin' | 'member') {
  const other = selfMemberId === ANA ? BEA : ANA;
  return {
    id: GROUP_ID,
    name: 'Flatmates',
    defaultRateType: 'blue',
    role: selfRole,
    memberCount: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    selfMemberId,
    members: [
      {
        id: selfMemberId,
        displayName: 'Self',
        isGhost: false,
        role: selfRole,
        joinedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: other,
        displayName: 'Other',
        isGhost: false,
        role: 'member',
        joinedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    formerMembers: [],
  };
}

const settlement = (id: string, overrides: Record<string, unknown> = {}): SettlementResponse => ({
  id,
  groupId: GROUP_ID,
  fromMemberId: ANA,
  toMemberId: BEA,
  currency: 'ARS',
  amount: '150050',
  legs: [{ currency: 'ARS', amount: '150050' }],
  occurredAt: '2026-10-05T15:30:00.000Z',
  createdByMemberId: ANA,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  version: 1,
  ...overrides,
});

const consolidated = (id: string) =>
  settlement(id, { currency: 'USD', rate: '12345678', rateSource: 'manual', rateType: 'blue' });

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<SettlementsHistoryContainer groupId={GROUP_ID} />, { locale });

function serve(items: SettlementResponse[], self: [string, 'admin' | 'member'] = [ANA, 'member']) {
  return stubApi({
    [GET_GROUP]: { status: 200, body: group(self[0], self[1]) },
    [FIRST_PAGE]: { status: 200, body: { items, nextCursor: null } },
  });
}

const readQueue = () => withGroupQueue(USER, (database) => loadGroupQueue(database));
const seed = (work: (database: IDBDatabase) => Promise<unknown>) => withGroupQueue(USER, work);

async function seedRejected(code: string) {
  await seed(async (database) => {
    await queueGroupUpdate(database, {
      kind: 'settlement',
      base: settlement(S1),
      request: { amount: '99900' },
    });
    await markGroupRejected(database, 'settlement', S1, code);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
});

describe('Settlement history actions (DISC-001-05h Block 8)', () => {
  it('offers edit and delete on a plain row and delete only on a consolidated one', async () => {
    serve([settlement(S1), consolidated(S2)]);
    open();
    await screen.findAllByRole('listitem');
    await screen.findAllByRole('button', { name: actions.delete });

    const rows = screen.getAllByRole('listitem');
    const plain = within(rows[0] as HTMLElement);
    expect(plain.getByRole('link', { name: actions.edit }).getAttribute('href')).toContain(
      `/groups/${GROUP_ID}/settlements/${S1}/edit`,
    );
    expect(plain.getByRole('button', { name: actions.delete })).toBeTruthy();
    const cons = within(rows[1] as HTMLElement);
    expect(cons.queryByRole('link', { name: actions.edit })).toBeNull();
    expect(cons.getByRole('button', { name: actions.delete })).toBeTruthy();
  });

  it('shows nothing to a member who is neither creator nor admin, and everything to an admin', async () => {
    serve([settlement(S1)], [BEA, 'member']);
    const first = open();
    await screen.findAllByRole('listitem');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('button', { name: actions.delete })).toBeNull();
    expect(screen.queryByRole('link', { name: actions.edit })).toBeNull();
    first.unmount();

    serve([settlement(S1)], [BEA, 'admin']);
    open();
    expect(await screen.findByRole('button', { name: actions.delete })).toBeTruthy();
    expect(screen.getByRole('link', { name: actions.edit })).toBeTruthy();
  });

  it('queues the deletion on confirm and hides the row; cancel leaves it', async () => {
    const spy = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, spy);
    const { calls } = serve([settlement(S1)]);
    open();
    await userEvent.click(await screen.findByRole('button', { name: actions.delete }));
    await userEvent.click(
      screen.getByRole('button', { name: en.groups.edit.common.deleteConfirm.cancel }),
    );
    expect(await readQueue()).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: actions.delete }));
    await userEvent.click(
      screen.getByRole('button', { name: en.groups.edit.common.deleteConfirm.confirm }),
    );

    await waitFor(() => {
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'settlement', operation: 'delete', id: S1 });
    expect(spy).toHaveBeenCalled();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, spy);
  });

  it('marks a queued update as waiting and shows the queued values', async () => {
    await seed((database) =>
      queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(S1),
        request: { amount: '99900' },
      }),
    );
    serve([settlement(S1)]);
    open();

    const row = within(await screen.findByRole('listitem'));
    expect(await row.findByText(en.groups.edit.common.sync.pending)).toBeTruthy();
    expect(row.getByText(money(99900n))).toBeTruthy();
    expect(row.queryByText(money(150050n))).toBeNull();
  });

  it('marks a rejection as failed with its reason; retry asks for a pass', async () => {
    await seedRejected('GROUP_RECORD_EDIT_FORBIDDEN');
    const spy = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, spy);
    serve([settlement(S1)]);
    open();

    expect(await screen.findByText(en.groups.edit.common.sync.failed)).toBeTruthy();
    expect(screen.getByText(en.errors.groupRecordEditForbidden)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: actions.retry }));
    await waitFor(() => {
      expect(screen.queryByText(en.groups.edit.common.sync.failed)).toBeNull();
    });
    expect(spy).toHaveBeenCalled();
    expect((await readQueue())[0]?.rejection).toBeUndefined();
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, spy);
  });

  it('discard drops the change and shows the record as the server holds it', async () => {
    await seedRejected('GROUP_RECORD_EDIT_FORBIDDEN');
    serve([settlement(S1)]);
    open();

    await userEvent.click(await screen.findByRole('button', { name: actions.discard }));

    expect(await screen.findByText(money(150050n))).toBeTruthy();
    expect(screen.queryByText(en.groups.edit.common.sync.failed)).toBeNull();
    expect(await readQueue()).toHaveLength(0);
  });

  it('offers only discard for a refusal retrying cannot fix', async () => {
    await seedRejected('GROUP_SETTLEMENT_CONSOLIDATED');
    serve([settlement(S1)]);
    open();

    expect(await screen.findByRole('button', { name: actions.discard })).toBeTruthy();
    expect(screen.queryByRole('button', { name: actions.retry })).toBeNull();
  });

  it('marks a conflict and links to the resolution', async () => {
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(S1),
        request: { amount: '99900' },
      });
      const [queued] = await loadGroupQueue(database);
      await markGroupConflict(
        database,
        'settlement',
        S1,
        queued?.revision ?? 0,
        settlement(S1, { amount: '777', version: 2 }),
      );
    });
    serve([settlement(S1)]);
    open();

    expect(await screen.findByText(en.groups.edit.common.sync.conflict)).toBeTruthy();
    const link = screen.getByRole('link', { name: actions.resolve });
    expect(link.getAttribute('href')).toContain(`/groups/${GROUP_ID}/settlements/${S1}/edit`);
  });

  it('shows the new values with no marker after the pass finishes', async () => {
    await seed((database) =>
      queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(S1),
        request: { amount: '99900' },
      }),
    );
    const { calls } = stubApi({
      [GET_GROUP]: { status: 200, body: group(ANA, 'member') },
      [FIRST_PAGE]: [
        { status: 200, body: { items: [settlement(S1)], nextCursor: null } },
        {
          status: 200,
          body: { items: [settlement(S1, { amount: '99900', version: 2 })], nextCursor: null },
        },
      ],
    });
    open();
    await screen.findByText(en.groups.edit.common.sync.pending);

    await act(async () => {
      await seed((database) => discardGroupChange(database, 'settlement', S1));
      notifyQueueChanged();
      notifySyncFinished();
    });

    await waitFor(() => {
      expect(screen.queryByText(en.groups.edit.common.sync.pending)).toBeNull();
    });
    expect(screen.getByText(money(99900n))).toBeTruthy();
    expect(calls.filter((call) => call.path.endsWith('limit=50')).length).toBe(2);
  });

  it('makes exactly 2 requests on load', async () => {
    const { calls } = serve([settlement(S1)]);
    open();
    await screen.findAllByRole('listitem');
    expect(calls).toHaveLength(2);
  });

  it('shows the unavailable text once and still lists the rows when the queue cannot be read', async () => {
    localStorage.clear();
    serve([settlement(S1), settlement(S2)]);
    open();

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    expect(await screen.findAllByText(en.groups.edit.common.unavailable)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: actions.delete })).toBeNull();
  });

  it('renders the row actions in Spanish', async () => {
    serve([settlement(S1)]);
    open('es');
    expect(
      await screen.findByRole('button', { name: es.groups.edit.common.actions.delete }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: es.groups.edit.common.actions.edit })).toBeTruthy();
  });
});
