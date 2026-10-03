import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import { GetMovement } from '../../src/movements/application/get-movement';
import { ListMovements } from '../../src/movements/application/list-movements';
import { ResourceNotFound } from '../../src/shared/access';
import { FakeUserPreferences, InMemoryMovementRepository, readScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let movements: InMemoryMovementRepository;
let preferences: FakeUserPreferences;
let list: ListMovements;
let get: GetMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  preferences = new FakeUserPreferences();
  list = new ListMovements({ movements, preferences });
  get = new GetMovement({ movements });
});

describe('ListMovements', () => {
  it('returns only the scope movements, newest first, stable for equal dates', async () => {
    const old = movements.seed(ALICE, { occurredAt: new Date('2026-09-01T00:00:00Z') });
    const recent = movements.seed(ALICE, { occurredAt: new Date('2026-10-01T00:00:00Z') });
    const tieA = movements.seed(ALICE, { occurredAt: new Date('2026-09-15T00:00:00Z') });
    const tieB = movements.seed(ALICE, { occurredAt: new Date('2026-09-15T00:00:00Z') });
    movements.seed(BOB);

    const first = await list.execute(await readScopeFor(ALICE), { limit: 50, offset: 0 });
    const second = await list.execute(await readScopeFor(ALICE), { limit: 50, offset: 0 });

    expect(first.total).toBe(4);
    const ties = [tieA.id, tieB.id].sort().reverse();
    expect(first.items.map((m) => m.id)).toEqual([recent.id, ...ties, old.id]);
    expect(second.items.map((m) => m.id)).toEqual(first.items.map((m) => m.id));
  });

  it('applies offset and limit and re-validates them', async () => {
    for (let i = 0; i < 3; i++) movements.seed(ALICE);
    const scope = await readScopeFor(ALICE);

    const page = await list.execute(scope, { limit: 2, offset: 2 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);

    for (const bad of [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 10, offset: -1 },
      { limit: 10, offset: 0.5 },
    ]) {
      await expect(list.execute(scope, bad)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(list.execute(scope, bad)).rejects.toBeInstanceOf(AppError);
    }
    await expect(list.execute(scope, { limit: 100, offset: 0 })).resolves.toBeDefined();
  });
});

describe('ListMovements filters', () => {
  const ACCOUNT = '44444444-4444-4444-8444-444444444444';
  const CATEGORY = '55555555-5555-4555-8555-555555555555';

  it('passes every filter and the UTC interval of the local days to the repository', async () => {
    const scope = await readScopeFor(ALICE);

    await list.execute(scope, {
      limit: 20,
      offset: 40,
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      type: 'income',
      tag: 'Viaje',
      from: '2026-10-01',
      to: '2026-10-05',
    });

    expect(movements.listCalls).toHaveLength(1);
    expect(movements.listCalls[0]).toEqual({
      scope,
      options: {
        limit: 20,
        offset: 40,
        filters: {
          accountId: ACCOUNT,
          categoryId: CATEGORY,
          type: 'income',
          tag: 'Viaje',
          occurredFrom: new Date('2026-10-01T03:00:00.000Z'),
          occurredBefore: new Date('2026-10-06T03:00:00.000Z'),
        },
      },
    });
  });

  it("uses the user's time zone for the local days", async () => {
    preferences.values = { ...preferences.values, timeZone: 'UTC' };

    await list.execute(await readScopeFor(ALICE), {
      limit: 10,
      offset: 0,
      from: '2026-10-01',
      to: '2026-10-01',
    });

    expect(movements.listCalls[0]?.options.filters).toEqual({
      occurredFrom: new Date('2026-10-01T00:00:00.000Z'),
      occurredBefore: new Date('2026-10-02T00:00:00.000Z'),
    });
  });

  it('passes only the filters given and does not read the time zone without a date', async () => {
    await list.execute(await readScopeFor(ALICE), { limit: 10, offset: 0, tag: 'x' });

    expect(movements.listCalls[0]?.options.filters).toEqual({ tag: 'x' });
    expect(preferences.findCalls).toBe(0);
  });

  it('narrows the fake by the filters it receives', async () => {
    const hit = movements.seed(ALICE, {
      accountId: ACCOUNT,
      tags: ['Viaje'],
      occurredAt: new Date('2026-10-02T02:30:00Z'),
    });
    movements.seed(ALICE, {
      accountId: ACCOUNT,
      tags: ['Viaje'],
      occurredAt: new Date('2026-10-02T03:30:00Z'),
    });
    movements.seed(ALICE, { tags: ['viaje'] });

    const result = await list.execute(await readScopeFor(ALICE), {
      limit: 10,
      offset: 0,
      accountId: ACCOUNT,
      tag: 'viaje',
      from: '2026-10-01',
      to: '2026-10-01',
    });

    expect(result.items.map((m) => m.id)).toEqual([hit.id]);
    expect(result.total).toBe(1);
  });

  it('answers VALIDATION_FAILED for from later than to and never calls the repository', async () => {
    const attempt = list.execute(await readScopeFor(ALICE), {
      limit: 10,
      offset: 0,
      from: '2026-10-05',
      to: '2026-10-04',
    });

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(movements.listCalls).toHaveLength(0);
  });

  it('accepts from equal to to', async () => {
    await expect(
      list.execute(await readScopeFor(ALICE), {
        limit: 10,
        offset: 0,
        from: '2026-10-05',
        to: '2026-10-05',
      }),
    ).resolves.toBeDefined();
  });

  it('answers VALIDATION_FAILED for a page out of range even with filters', async () => {
    const scope = await readScopeFor(ALICE);
    for (const page of [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 10, offset: -1 },
    ]) {
      await expect(
        list.execute(scope, { ...page, accountId: ACCOUNT, from: '2026-10-01' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(movements.listCalls).toHaveLength(0);
    expect(preferences.findCalls).toBe(0);
  });

  it('propagates repository and preferences failures unchanged', async () => {
    const scope = await readScopeFor(ALICE);
    const repositoryFailure = new Error('db down');
    movements.listError = repositoryFailure;
    await expect(list.execute(scope, { limit: 10, offset: 0 })).rejects.toBe(repositoryFailure);

    const preferencesFailure = new Error('prefs down');
    preferences.findError = preferencesFailure;
    await expect(list.execute(scope, { limit: 10, offset: 0, from: '2026-10-01' })).rejects.toBe(
      preferencesFailure,
    );
  });

  it("reaches the repository with another user's scope, never the caller's", async () => {
    movements.seed(ALICE, { accountId: ACCOUNT });
    const bob = movements.seed(BOB, { accountId: ACCOUNT });
    const bobScope = await readScopeFor(BOB);

    const result = await list.execute(bobScope, { limit: 10, offset: 0, accountId: ACCOUNT });

    expect(movements.listCalls[0]?.scope.userId).toBe(BOB);
    expect(result.items.map((m) => m.id)).toEqual([bob.id]);
  });
});

describe('GetMovement', () => {
  it('returns an own movement and 404s on a foreign or unknown id', async () => {
    const mine = movements.seed(ALICE);
    const theirs = movements.seed(BOB);
    const scope = await readScopeFor(ALICE);

    await expect(get.execute(scope, mine.id)).resolves.toMatchObject({ id: mine.id });
    await expect(get.execute(scope, theirs.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(get.execute(scope, '33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});
