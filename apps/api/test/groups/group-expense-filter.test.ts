import { randomUUID } from 'node:crypto';
import {
  expenseOptionsResponseSchema,
  groupExpensePageSchema,
  type CreateGroupExpenseRequest,
} from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AddGhostMember,
  CreateGroup,
  CreateGroupCategory,
  CreateInvitation,
  JoinGroup,
  ListGroupExpenses,
  RecordGroupExpense,
  type Member,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { InMemoryGroupExpenseRepository, InMemoryPayerMovementRecorder } from './expense-fakes';
import { DeterministicTokenSource, FakeClock, InMemoryGroupRepository } from './fakes';
import { call, createGroup, setupGroupApi } from './routes-harness';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';

describe('ListGroupExpenses filters', () => {
  let clock: FakeClock;
  let groups: InMemoryGroupRepository;
  let expenses: InMemoryGroupExpenseRepository;
  let list: ListGroupExpenses;
  let record: RecordGroupExpense;
  let groupId: string;
  let bob: Member;
  let alice: Member;
  let cats: string[];

  beforeEach(async () => {
    clock = new FakeClock();
    groups = new InMemoryGroupRepository(clock);
    const recorder = new InMemoryPayerMovementRecorder();
    expenses = new InMemoryGroupExpenseRepository(groups, recorder);
    const deps = {
      groups,
      clock,
      tokens: new DeterministicTokenSource(),
      expenses,
      payerMovements: recorder,
    };
    list = new ListGroupExpenses(deps);
    record = new RecordGroupExpense(deps);
    const created = await new CreateGroup(deps).execute(ALICE, {
      name: 'Casa',
      defaultRateType: 'blue',
    });
    groupId = created.group.id;
    const invitation = await new CreateInvitation(deps).execute(ALICE, groupId);
    await new JoinGroup(deps).execute(BOB, invitation.token);
    await new AddGhostMember(deps).execute(ALICE, groupId, { displayName: 'Pedro' });
    alice = (await groups.findMember(groupId, ALICE)) as Member;
    bob = (await groups.findMember(groupId, BOB)) as Member;
    const first = (await groups.listCategories(groupId))[0] as { id: string };
    const createCategory = new CreateGroupCategory(deps);
    const second = await createCategory.execute(ALICE, groupId, {
      name: 'Mascotas',
      icon: 'paw-print',
      color: 'orange',
    });
    const third = await createCategory.execute(ALICE, groupId, {
      name: 'Regalos',
      icon: 'gift',
      color: 'blue',
    });
    cats = [first.id, second.id, third.id];
  });

  async function add(categoryId: string, occurredAt: string): Promise<string> {
    const request: CreateGroupExpenseRequest = {
      amount: '1000',
      currency: 'ARS',
      occurredAt,
      payerMemberId: bob.id,
      categoryId,
      description: 'Gasto',
      split: { mode: 'equal', memberIds: [alice.id, bob.id] },
    };
    return (await record.execute(ALICE, groupId, request)).id;
  }

  it('returns only the category and month asked for, newest first (AC-25)', async () => {
    const first = await add(cats[0] ?? '', '2026-09-05T10:00:00.000Z');
    const second = await add(cats[0] ?? '', '2026-09-20T10:00:00.000Z');
    await add(cats[1] ?? '', '2026-08-10T10:00:00.000Z');
    await add(cats[0] ?? '', '2026-08-10T10:00:00.000Z');

    const page = await list.execute(ALICE, groupId, {
      limit: 50,
      categoryIds: [cats[0] ?? ''],
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    });

    expect(page.items.map((e) => e.id)).toEqual([second, first]);
  });

  it('returns the union of two categories and a cursor continues the same filter (AC-04)', async () => {
    const ids: string[] = [];
    for (const day of ['01', '02', '03', '04', '05']) {
      ids.push(await add(cats[Number(day) % 2] ?? '', `2026-09-${day}T10:00:00.000Z`));
    }
    await add(cats[2] ?? '', '2026-09-06T10:00:00.000Z');
    const categoryIds = [cats[0] ?? '', cats[1] ?? ''];

    const first = await list.execute(ALICE, groupId, { limit: 2, categoryIds });
    const second = await list.execute(ALICE, groupId, {
      limit: 2,
      categoryIds,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    const third = await list.execute(ALICE, groupId, {
      limit: 2,
      categoryIds,
      ...(second.nextCursor === null ? {} : { cursor: second.nextCursor }),
    });

    const seen = [...first.items, ...second.items, ...third.items].map((e) => e.id);
    expect(seen).toEqual([...ids].reverse());
    expect(third.nextCursor).toBeNull();
  });

  it('treats from and to as inclusive bounds (AC-25)', async () => {
    const atFrom = await add(cats[0] ?? '', '2026-08-01T00:00:00.000Z');
    const atTo = await add(cats[0] ?? '', '2026-08-31T23:59:59.999Z');
    await add(cats[0] ?? '', '2026-07-31T23:59:59.999Z');
    await add(cats[0] ?? '', '2026-09-01T00:00:00.000Z');

    const page = await list.execute(ALICE, groupId, {
      limit: 50,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
    });

    expect(page.items.map((e) => e.id)).toEqual([atTo, atFrom]);
  });

  it('is exactly the old list without filters (AC-05)', async () => {
    const a = await add(cats[0] ?? '', '2026-09-01T10:00:00.000Z');
    const b = await add(cats[2] ?? '', '2026-10-01T10:00:00.000Z');

    const page = await list.execute(ALICE, groupId, { limit: 50 });

    expect(page.items.map((e) => e.id)).toEqual([b, a]);
  });

  it('answers an empty page for a category of another group (NFR-06)', async () => {
    await add(cats[0] ?? '', '2026-10-01T10:00:00.000Z');

    const page = await list.execute(ALICE, groupId, { limit: 50, categoryIds: [randomUUID()] });

    expect(page.items).toEqual([]);
  });

  it('answers 404 to a non-member and to an unknown group (AC-28)', async () => {
    const filters = { limit: 50, categoryIds: [cats[0] ?? ''] };
    await expect(list.execute(STRANGER, groupId, filters)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(list.execute(ALICE, randomUUID(), filters)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('GET /groups/:id/expenses with filters', () => {
  let connection: DatabaseConnection;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  async function world() {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const options = expenseOptionsResponseSchema.parse(
      (await call(api.app, 'get', `/groups/${group.id}/expense-options`, ana.cookies)).body,
    );
    return { api, ana, groupId: group.id, categoryId: options.categories[0]?.id ?? '' };
  }

  it('rejects invalid filters with 400 before anything else runs (AC-06, AC-27)', async () => {
    const w = await world();
    const missingGroup = randomUUID();
    const bad = [
      'categoryIds=not-a-uuid',
      `categoryIds=${w.categoryId},${w.categoryId}`,
      'from=2026-10-31T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
      'from=2026-01-01T00:00:00.000Z&to=2027-01-03T00:00:00.000Z',
    ];

    for (const query of bad) {
      // An unknown group would be 404: a 400 proves validation runs before the use case.
      const response = await call(
        w.api.app,
        'get',
        `/groups/${missingGroup}/expenses?${query}`,
        w.ana.cookies,
      );
      expect(response.status, query).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('answers 404 to a non-member and 401 without a session (AC-28)', async () => {
    const w = await world();
    const outsider = await w.api.makeUser('outsider');
    const path = `/groups/${w.groupId}/expenses?categoryIds=${w.categoryId}`;

    expect((await call(w.api.app, 'get', path, outsider.cookies)).status).toBe(404);
    expect((await call(w.api.app, 'get', path)).status).toBe(401);
  });

  it('answers an empty page for a valid filter with no match, same shape as before', async () => {
    const w = await world();

    const response = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/expenses?categoryIds=${randomUUID()}&from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.999Z`,
      w.ana.cookies,
    );

    expect(response.status).toBe(200);
    expect(groupExpensePageSchema.parse(response.body)).toEqual({ items: [], nextCursor: null });
  });
});
