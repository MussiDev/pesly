// @vitest-environment happy-dom
import type { SettlementResponse } from '@pesly/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettlementEditContainer } from '../src/features/groups/settlements-edit/settlement-edit-container';
import { openLocalDatabase } from '../src/lib/local-store/database';
import {
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  queueGroupDelete,
  queueGroupUpdate,
  readGroupChange,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { MOVEMENT_QUEUED_EVENT } from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const USER = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const ANA = '00000000-0000-4000-8000-000000000201';
const BEA = '00000000-0000-4000-8000-000000000202';
const CAL = '00000000-0000-4000-8000-000000000203';

const GET_GROUP = `GET /groups/${GROUP}`;
const GET_SETTLEMENT = `GET /groups/${GROUP}/settlements/${SETTLEMENT}`;

function group(selfMemberId: string) {
  const member = (id: string, displayName: string, role: 'admin' | 'member') => ({
    id,
    displayName,
    isGhost: false,
    role,
    joinedAt: '2026-10-01T00:00:00.000Z',
  });
  return {
    id: GROUP,
    name: 'Flatmates',
    defaultRateType: 'blue',
    role: 'member',
    memberCount: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    selfMemberId,
    members: [
      member(ANA, 'Ana', 'admin'),
      member(BEA, 'Bea', 'member'),
      member(CAL, 'Cal', 'member'),
    ],
    formerMembers: [],
  };
}

function settlement(overrides: Partial<SettlementResponse> = {}): SettlementResponse {
  return {
    id: SETTLEMENT,
    groupId: GROUP,
    fromMemberId: ANA,
    toMemberId: BEA,
    currency: 'ARS',
    amount: '2500',
    legs: [{ currency: 'ARS', amount: '2500' }],
    occurredAt: '2026-10-03T10:00:00.000Z',
    createdByMemberId: BEA,
    accountId: null,
    rate: null,
    rateSource: null,
    rateType: null,
    createdAt: '2026-10-03T10:01:00.000Z',
    version: 1,
    ...overrides,
  };
}

/** Bea created it; Bea (self) is neither admin nor anything else but the creator. */
function routes(self: string, record: SettlementResponse = settlement()) {
  return {
    [GET_GROUP]: { status: 200, body: group(self) },
    [GET_SETTLEMENT]: { status: 200, body: record },
  };
}

async function withDatabase<T>(work: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openLocalDatabase(USER);
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

const readQueue = () => withDatabase((database) => loadGroupQueue(database));

function open(locale: 'es' | 'en' = 'es', settlementId = SETTLEMENT, groupId = GROUP) {
  return renderApp(<SettlementEditContainer groupId={groupId} settlementId={settlementId} />, {
    locale,
  });
}

const copy = CATALOGS.es.groups.edit.settlement;
const common = CATALOGS.es.groups.edit.common;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
});

describe('SettlementEditContainer (DISC-001-05h Block 6)', () => {
  it('offers amount and date as fields and shows parties, currency and account as text (AC-10)', async () => {
    stubApi(routes(BEA));
    open();

    const amount = await screen.findByLabelText(copy.fields.amount);
    expect((amount as HTMLInputElement).value).toBe('25,00');
    expect(screen.getByLabelText(copy.fields.occurredAt)).toBeTruthy();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.getByText('ARS')).toBeTruthy();
    expect(screen.getByText(copy.account.none)).toBeTruthy();
  });

  it('shows "recorded against an account" when the settlement has one', async () => {
    stubApi(routes(BEA, settlement({ accountId: '00000000-0000-4000-8000-000000000999' })));
    open();

    expect(await screen.findByText(copy.account.recorded)).toBeTruthy();
  });

  it.each([
    ['', CATALOGS.es.movements.errors.amountInvalid],
    ['0', CATALOGS.es.movements.errors.amountNotPositive],
    ['0,00', CATALOGS.es.movements.errors.amountNotPositive],
  ])('shows a field error for the amount %j and queues nothing (AC-11)', async (typed, message) => {
    stubApi(routes(BEA));
    open();

    const amount = await screen.findByLabelText(copy.fields.amount);
    await userEvent.clear(amount);
    if (typed !== '') await userEvent.type(amount, typed);
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(await readQueue()).toHaveLength(0);
  });

  it('saving with no change shows nothingChanged and queues nothing', async () => {
    stubApi(routes(BEA));
    open();

    await screen.findByLabelText(copy.fields.amount);
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));

    expect(await screen.findByText(copy.errors.nothingChanged)).toBeTruthy();
    expect(await readQueue()).toHaveLength(0);
  });

  it('saving queues one update based on the loaded record, asks for a pass and returns (AC-06)', async () => {
    const { calls } = stubApi(routes(BEA));
    const queued = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, queued);
    const { router } = open();

    const amount = await screen.findByLabelText(copy.fields.amount);
    await userEvent.clear(amount);
    await userEvent.type(amount, '30,00');
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/groups/${GROUP}/settlements`);
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      kind: 'settlement',
      operation: 'update',
      base: settlement(),
      request: { amount: '3000' },
    });
    expect(queued).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, queued);
  });

  it('starts the fields from the queued request, not the loaded record (D8)', async () => {
    await withDatabase((database) =>
      queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(),
        request: { amount: '2600' },
      }),
    );
    stubApi(routes(BEA));
    open();

    const amount = await screen.findByLabelText(copy.fields.amount);
    expect((amount as HTMLInputElement).value).toBe('26,00');
  });

  it('a consolidated settlement shows no fields and only the deletion (AC-12, AC-13)', async () => {
    stubApi(
      routes(
        BEA,
        settlement({ rate: '12345678', rateSource: 'manual', rateType: 'blue', currency: 'USD' }),
      ),
    );
    open();

    expect(await screen.findByText(copy.deleteOnly.description)).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.amount)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.submit })).toBeNull();
    expect(screen.getByRole('button', { name: common.actions.delete })).toBeTruthy();
  });

  it('confirming the deletion queues it and cancelling does not (AC-14, AC-09)', async () => {
    stubApi(routes(BEA));
    const { router } = open();

    await screen.findByLabelText(copy.fields.amount);
    await userEvent.click(screen.getByRole('button', { name: common.actions.delete }));
    await userEvent.click(
      within(screen.getByRole('group')).getByRole('button', { name: common.deleteConfirm.cancel }),
    );
    expect(await readQueue()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: common.deleteConfirm.confirm })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: common.actions.delete }));
    await userEvent.click(screen.getByRole('button', { name: common.deleteConfirm.confirm }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'settlement', operation: 'delete', base: settlement() });
  });

  it('confirming the deletion of a consolidated settlement queues it', async () => {
    const consolidated = settlement({ rate: '12345678', rateSource: 'manual', rateType: 'blue' });
    stubApi(routes(BEA, consolidated));
    open();

    await userEvent.click(await screen.findByRole('button', { name: common.actions.delete }));
    await userEvent.click(screen.getByRole('button', { name: common.deleteConfirm.confirm }));

    await waitFor(async () => {
      expect(await readQueue()).toHaveLength(1);
    });
  });

  it('a member who is neither creator nor admin sees not-allowed and no fields (AC-16)', async () => {
    stubApi(routes(CAL));
    open();

    expect(await screen.findByText(copy.notAllowed.title)).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.amount)).toBeNull();
    expect(screen.queryByRole('button', { name: common.actions.delete })).toBeNull();
  });

  it('the creator and an admin see the actions (AC-15)', async () => {
    stubApi(routes(ANA));
    open();
    expect(await screen.findByLabelText(copy.fields.amount)).toBeTruthy();
  });

  it('shows the message of a rejection and keeps the typed values (AC-17, AC-19, AC-25)', async () => {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(),
        request: { amount: '2600' },
      });
      await markGroupRejected(database, 'settlement', SETTLEMENT, 'GROUP_RECORD_EDIT_FORBIDDEN');
    });
    stubApi(routes(BEA));
    open();

    expect(await screen.findByText(CATALOGS.es.errors.groupRecordEditForbidden)).toBeTruthy();
    expect(screen.getByRole('button', { name: common.actions.retry })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(copy.fields.amount).value).toBe('26,00');
  });

  it('a consolidated refusal offers only discard, and discarding removes the change', async () => {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(),
        request: { amount: '2600' },
      });
      await markGroupRejected(database, 'settlement', SETTLEMENT, 'GROUP_SETTLEMENT_CONSOLIDATED');
    });
    stubApi(routes(BEA));
    open();

    await screen.findByText(CATALOGS.es.errors.groupSettlementConsolidated);
    expect(screen.queryByRole('button', { name: common.actions.retry })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: common.actions.discard }));

    await waitFor(async () => {
      expect(await readQueue()).toHaveLength(0);
    });
  });

  it('a queued deletion shows the already-deleting state with no fields', async () => {
    await withDatabase((database) =>
      queueGroupDelete(database, { kind: 'settlement', base: settlement() }),
    );
    stubApi(routes(BEA));
    open();

    expect(await screen.findByText(copy.deleting.title)).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.amount)).toBeNull();
  });

  it('a 404 on the settlement shows not-found (AC-18)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group(BEA) },
      [GET_SETTLEMENT]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
    });
    open();

    expect(await screen.findByText(copy.notFound.title)).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.amount)).toBeNull();
  });

  it('another load failure shows the shared load-failed state with retry', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group(BEA) },
      [GET_SETTLEMENT]: { status: 500 },
    });
    open();

    expect(await screen.findByRole('button', { name: CATALOGS.es.app.retry })).toBeTruthy();
  });

  async function queueConflict() {
    await withDatabase(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlement(),
        request: { amount: '2600' },
      });
      await markGroupConflict(
        database,
        'settlement',
        SETTLEMENT,
        1,
        settlement({ amount: '3000', version: 2 }),
      );
    });
  }

  it('a settlement in conflict shows both versions and "keep mine" keeps the change queued (AC-26, AC-27)', async () => {
    await queueConflict();
    stubApi(routes(BEA));
    const queued = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, queued);
    open();

    expect(
      await screen.findByRole('region', { name: CATALOGS.es.groupConflict.mine }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: CATALOGS.es.groupConflict.server })).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.amount)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: CATALOGS.es.groupConflict.keepMine }));

    await waitFor(() => {
      expect(queued).toHaveBeenCalledTimes(1);
    });
    const change = await withDatabase((database) =>
      readGroupChange(database, 'settlement', SETTLEMENT),
    );
    expect(change?.conflict).toBeUndefined();
    expect(change?.base.version).toBe(2);
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, queued);
  });

  it('"keep server\'s" drops the queued change (AC-28)', async () => {
    await queueConflict();
    stubApi(routes(BEA));
    open();

    await userEvent.click(
      await screen.findByRole('button', { name: CATALOGS.es.groupConflict.keepServer }),
    );

    await waitFor(async () => {
      expect(await readQueue()).toHaveLength(0);
    });
  });

  it('makes exactly 2 API requests on load (NFR-02)', async () => {
    const { calls } = stubApi(routes(BEA));
    open();

    await screen.findByLabelText(copy.fields.amount);
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(
      [GET_GROUP, GET_SETTLEMENT].sort(),
    );
  });

  it('renders in English with the English catalog (AC-37)', async () => {
    stubApi(routes(BEA));
    open('en');

    const en = CATALOGS.en.groups.edit.settlement;
    const amount = await screen.findByLabelText(en.fields.amount);
    expect((amount as HTMLInputElement).value).toBe('25.00');
    expect(screen.getByRole('button', { name: en.submit })).toBeTruthy();
    expect(en.fields.amount).not.toBe(copy.fields.amount);
  });

  it('a malformed route id shows not-found and sends no request', async () => {
    const { calls } = stubApi(routes(BEA));
    open('es', 'not-a-uuid');

    expect(await screen.findByText(copy.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('a malformed group id shows not-found and sends no request', async () => {
    const { calls } = stubApi(routes(BEA));
    open('es', SETTLEMENT, 'nope');

    expect(await screen.findByText(CATALOGS.es.groups.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('has the same groups.edit.settlement keys in both catalogs, none empty', () => {
    const flat = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => flat(child, `${prefix}${key}.`))
        : typeof value === 'string' && value.length > 0
          ? [prefix]
          : [`${prefix}EMPTY`];
    const es = flat(CATALOGS.es.groups.edit.settlement);
    const en = flat(CATALOGS.en.groups.edit.settlement);
    expect(es.length).toBeGreaterThan(10);
    expect(es.filter((key) => key.endsWith('EMPTY'))).toEqual([]);
    expect(es).toEqual(en);
  });

  it('keeps the settlement date field editable (date change builds occurredAt)', async () => {
    stubApi(routes(BEA));
    open();

    const date = await screen.findByLabelText(copy.fields.occurredAt);
    fireEvent.change(date, { target: { value: '2026-10-04T09:00' } });
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));

    await waitFor(async () => {
      expect((await readQueue())[0]).toMatchObject({
        request: { occurredAt: '2026-10-04T09:00:00.000Z' },
      });
    });
  });
});
