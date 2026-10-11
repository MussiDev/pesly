// @vitest-environment happy-dom
import type { GroupExpenseResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseEditContainer } from '../src/features/groups/expenses/edit/expense-edit-container';
import { openLocalDatabase } from '../src/lib/local-store/database';
import {
  discardGroupChange,
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  queueGroupDelete,
  queueGroupUpdate,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { MOVEMENT_QUEUED_EVENT } from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const form = en.groups.expenses.form;
const edit = en.groups.edit;

const USER = '99999999-9999-4999-8999-999999999999';
const G = '55555555-5555-4555-8555-555555555555';
const E = '88888888-8888-4888-8888-888888888801';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

const GROUP = `GET /groups/${G}`;
const EXPENSE = `GET /groups/${G}/expenses/${E}`;
const OPTIONS = `GET /groups/${G}/expense-options`;

const NOW = new Date('2026-10-11T15:00:00.000Z');
const ZONE = 'America/Argentina/Buenos_Aires';

const member = (id: string, displayName: string, role: 'admin' | 'member') => ({
  id,
  displayName,
  isGhost: false,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

function groupBody(selfMemberId: string) {
  const roles = { [ANA]: 'member', [BRUNO]: 'member', [CARLA]: 'admin' } as const;
  return {
    id: G,
    name: 'Trip',
    defaultRateType: 'blue',
    role: roles[selfMemberId as keyof typeof roles],
    memberCount: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    selfMemberId,
    members: [
      member(ANA, 'Ana', 'member'),
      member(BRUNO, 'Bruno', 'member'),
      member(CARLA, 'Carla', 'admin'),
    ],
    formerMembers: [],
  };
}

const optionsBody = {
  selfMemberId: ANA,
  members: [
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: BRUNO, displayName: 'Bruno', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: CARLA, displayName: 'Carla', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
  ],
  categories: [
    { id: CATEGORY, defaultKey: null, name: 'Rent', icon: 'home', color: 'blue', archivedAt: null },
  ],
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
};

function expense(overrides: Partial<GroupExpenseResponse> = {}): GroupExpenseResponse {
  return {
    id: E,
    groupId: G,
    payerMemberId: BRUNO,
    createdByMemberId: ANA,
    amount: '1500050',
    currency: 'USD',
    occurredAt: '2026-10-05T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'Groceries',
    splitMode: 'equal',
    payerMovementId: null,
    createdAt: '2026-10-05T15:30:00.000Z',
    shares: [
      { memberId: ANA, amount: '500016' },
      { memberId: BRUNO, amount: '500018' },
      { memberId: CARLA, amount: '500016' },
    ],
    version: 3,
    ...overrides,
  };
}

function routes(self = ANA, record: GroupExpenseResponse = expense()) {
  return {
    [GROUP]: { status: 200, body: groupBody(self) },
    [EXPENSE]: { status: 200, body: record },
    [OPTIONS]: { status: 200, body: optionsBody },
  };
}

const request = (amount: string, description = 'Groceries') => ({
  amount,
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId: CATEGORY,
  description,
  split: { mode: 'equal' as const, memberIds: [ANA, BRUNO, CARLA] },
});

async function seed(work: (database: IDBDatabase) => Promise<unknown>) {
  const database = await openLocalDatabase(USER);
  try {
    await work(database);
  } finally {
    database.close();
  }
}

const readQueue = () => withGroupQueue(USER, (database) => loadGroupQueue(database));

function open(locale: 'en' | 'es' = 'en', ids = { groupId: G, expenseId: E }) {
  return renderApp(<ExpenseEditContainer {...ids} timeZone={ZONE} now={NOW} />, { locale });
}

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: edit.expense.submit });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
});

describe('ExpenseEditContainer (DISC-001-05h Block 5)', () => {
  it('starts from the amount, date, category, description and split of the expense', async () => {
    stubApi(routes());
    open();
    await screen.findByLabelText(form.fields.amount);
    expect(field(form.fields.amount).value).toBe('15,000.50');
    expect(field(form.fields.date).value).toBe('2026-10-05T12:30');
    expect(field(form.fields.description).value).toBe('Groceries');
    expect(field(form.fields.category).value).toBe(CATEGORY);
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it('shows the currency and the payer as text with no control to change them', async () => {
    stubApi(routes());
    open();
    await screen.findByLabelText(form.fields.amount);
    expect(screen.queryByLabelText(form.fields.currency)).toBeNull();
    expect(screen.queryByLabelText(form.fields.payer)).toBeNull();
    expect(screen.queryByLabelText(form.fields.account)).toBeNull();
    expect(screen.getByText('USD')).toBeTruthy();
    expect(screen.getAllByText('Bruno').length).toBeGreaterThan(0);
  });

  it('shows a field error and queues nothing for an empty and a 0 amount', async () => {
    stubApi(routes());
    open();
    await screen.findByLabelText(form.fields.amount);
    await userEvent.clear(field(form.fields.amount));
    await userEvent.click(save());
    expect(await screen.findByText(en.movements.errors.amountInvalid)).toBeTruthy();
    expect(field(form.fields.amount).getAttribute('aria-invalid')).toBe('true');
    await userEvent.type(field(form.fields.amount), '0');
    await userEvent.click(save());
    expect(await screen.findByText(en.movements.errors.amountNotPositive)).toBeTruthy();
    expect(await readQueue()).toHaveLength(0);
  });

  it('blocks saving a split that does not add up and queues nothing', async () => {
    stubApi(routes());
    open();
    await screen.findByLabelText(form.fields.amount);
    await userEvent.click(screen.getByRole('radio', { name: en.groups.split.modes.exact }));
    expect(save().disabled).toBe(true);
    expect(await readQueue()).toHaveLength(0);
  });

  it('queues one update based on the loaded record, asks for a pass and returns to the list', async () => {
    const { calls } = stubApi(routes());
    const asked = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, asked);
    const { router } = open();
    await screen.findByLabelText(form.fields.amount);
    expect(calls).toHaveLength(3);
    await userEvent.clear(field(form.fields.amount));
    await userEvent.type(field(form.fields.amount), '20000');
    await userEvent.click(save());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G}/expenses`);
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      kind: 'expense',
      operation: 'update',
      base: expense(),
      request: {
        amount: '2000000',
        occurredAt: '2026-10-05T15:30:00.000Z',
        categoryId: CATEGORY,
        description: 'Groceries',
      },
    });
    expect(queue[0]?.request).not.toHaveProperty('currency');
    expect(queue[0]?.request).not.toHaveProperty('payerMemberId');
    expect(asked).toHaveBeenCalledTimes(1);
    // None to save: the sync pass sends it.
    expect(calls).toHaveLength(3);
  });

  it('starts from the queued request when the record already has one', async () => {
    stubApi(routes());
    await seed((database) =>
      queueGroupUpdate(database, { kind: 'expense', base: expense(), request: request('777700') }),
    );
    open();
    await screen.findByLabelText(form.fields.amount);
    expect(field(form.fields.amount).value).toBe('7,777.00');
  });

  it('queues the deletion on confirm and nothing on cancel', async () => {
    stubApi(routes());
    const { router } = open();
    await screen.findByLabelText(form.fields.amount);
    await userEvent.click(screen.getByRole('button', { name: edit.common.actions.delete }));
    await userEvent.click(screen.getByRole('button', { name: edit.common.deleteConfirm.cancel }));
    expect(await readQueue()).toHaveLength(0);
    expect(screen.queryByText(edit.common.deleteConfirm.title)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: edit.common.actions.delete }));
    await userEvent.click(screen.getByRole('button', { name: edit.common.deleteConfirm.confirm }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/en/groups/${G}/expenses`);
    });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operation: 'delete', base: expense() });
  });

  it('shows the not-allowed state with no fields to a member who is neither creator nor admin', async () => {
    stubApi(routes(BRUNO));
    open();
    expect(await screen.findByText(edit.expense.notAllowed.title)).toBeTruthy();
    expect(screen.queryByLabelText(form.fields.amount)).toBeNull();
  });

  it('shows the form to the creator and to an admin', async () => {
    stubApi(routes(CARLA));
    open();
    expect(await screen.findByLabelText(form.fields.amount)).toBeTruthy();
  });

  it('shows the already-queued-deletion state', async () => {
    stubApi(routes());
    await seed((database) => queueGroupDelete(database, { kind: 'expense', base: expense() }));
    open();
    expect(await screen.findByText(edit.expense.queuedDelete.title)).toBeTruthy();
    expect(screen.queryByLabelText(form.fields.amount)).toBeNull();
  });

  it('shows a forbidden rejection with the entered values and retry and discard', async () => {
    stubApi(routes());
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(),
        request: request('777700', 'Typed text'),
      });
      await markGroupRejected(database, 'expense', E, 'GROUP_RECORD_EDIT_FORBIDDEN');
    });
    open();
    expect(await screen.findByText(en.errors.groupRecordEditForbidden)).toBeTruthy();
    expect(field(form.fields.description).value).toBe('Typed text');
    expect(screen.getByRole('button', { name: edit.common.actions.retry })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: edit.common.actions.discard }));
    await waitFor(async () => {
      expect(await readQueue()).toHaveLength(0);
    });
  });

  it('offers only discard for a former-member refusal', async () => {
    stubApi(routes());
    await seed(async (database) => {
      await queueGroupUpdate(database, {
        kind: 'expense',
        base: expense(),
        request: request('777700'),
      });
      await markGroupRejected(database, 'expense', E, 'GROUP_RECORD_FORMER_MEMBER');
    });
    open();
    expect(await screen.findByText(en.errors.groupRecordFormerMember)).toBeTruthy();
    expect(screen.queryByRole('button', { name: edit.common.actions.retry })).toBeNull();
    expect(screen.getByRole('button', { name: edit.common.actions.discard })).toBeTruthy();
  });

  it('shows not-found on a 404', async () => {
    stubApi({ ...routes(), [EXPENSE]: { status: 404, body: { code: 'NOT_FOUND', message: 'x' } } });
    open();
    expect(await screen.findByText(edit.expense.notFound.title)).toBeTruthy();
  });

  it('shows not-found and sends no request for a malformed id', async () => {
    const { calls } = stubApi(routes());
    open('en', { groupId: G, expenseId: 'nope' });
    expect(await screen.findByText(edit.expense.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows the shared load-failed state with retry on a server error', async () => {
    stubApi({ ...routes(), [OPTIONS]: [{ status: 500 }, { status: 200, body: optionsBody }] });
    open();
    await userEvent.click(await screen.findByRole('button', { name: en.app.retry }));
    expect(await screen.findByLabelText(form.fields.amount)).toBeTruthy();
  });

  describe('conflict', () => {
    async function seedConflict() {
      await seed(async (database) => {
        await queueGroupUpdate(database, {
          kind: 'expense',
          base: expense(),
          request: request('2000000', 'Mine'),
        });
        await markGroupConflict(
          database,
          'expense',
          E,
          1,
          expense({ version: 4, description: 'Theirs' }),
        );
      });
    }

    it('shows both versions with names; keep mine keeps it queued and asks for a pass', async () => {
      stubApi(routes());
      await seedConflict();
      const asked = vi.fn();
      window.addEventListener(MOVEMENT_QUEUED_EVENT, asked);
      open();
      const mine = await screen.findByRole('region', { name: en.groupConflict.mine });
      const server = screen.getByRole('region', { name: en.groupConflict.server });
      expect(within(mine).getAllByText('Mine').length).toBeGreaterThan(1);
      expect(within(server).getByText('Theirs')).toBeTruthy();
      expect(within(server).getAllByText(/Ana/).length).toBeGreaterThan(0);
      expect(within(server).getAllByText(/Rent/).length).toBeGreaterThan(0);
      expect(screen.queryByLabelText(form.fields.amount)).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: en.groupConflict.keepMine }));
      await waitFor(() => {
        expect(asked).toHaveBeenCalled();
      });
      const queue = await readQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]?.conflict).toBeUndefined();
    });

    it('keep server drops the queued change', async () => {
      stubApi(routes());
      await seedConflict();
      open();
      await userEvent.click(
        await screen.findByRole('button', { name: en.groupConflict.keepServer }),
      );
      await waitFor(async () => {
        expect(await readQueue()).toHaveLength(0);
      });
    });

    it('keeps both versions and shows the error when the choice is refused', async () => {
      stubApi(routes());
      await seedConflict();
      open();
      const keep = await screen.findByRole('button', { name: en.groupConflict.keepMine });
      // The change disappears behind the screen's back: the resolution has nothing to apply.
      await seed((database) => discardGroupChange(database, 'expense', E));
      await userEvent.click(keep);
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('region', { name: en.groupConflict.mine })).toBeTruthy();
      expect(screen.getByRole('region', { name: en.groupConflict.server })).toBeTruthy();
    });
  });

  it('renders in Spanish with the Spanish catalog', async () => {
    stubApi(routes());
    open('es');
    expect(await screen.findByRole('heading', { name: es.groups.edit.expense.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: es.groups.edit.expense.submit })).toBeTruthy();
  });

  it('has the same groups.edit.expense keys in both catalogs', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    expect(keys(es.groups.edit.expense).sort()).toEqual(keys(en.groups.edit.expense).sort());
    expect(keys(en.groups.edit.expense).length).toBeGreaterThan(5);
  });
});
