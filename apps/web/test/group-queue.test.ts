// @vitest-environment happy-dom
import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VERSION,
  GROUP_QUEUE_STORE,
  QUEUE_STORE,
  REFERENCE_STORE,
  openLocalDatabase,
} from '../src/lib/local-store/database';
import {
  GroupResolutionRefused,
  countGroupQueue,
  discardGroupChange,
  groupChangeBody,
  keepMine,
  keepServer,
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  queueGroupDelete,
  queueGroupUpdate,
  readCachedGroupRecord,
  readGroupChange,
  retryGroupChange,
  settleGroupSent,
  withGroupQueue,
} from '../src/lib/local-store/group-queue';

const ANA = '11111111-1111-4111-8111-111111111111';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT = '00000000-0000-4000-8000-000000000102';
const MEMBER_A = '00000000-0000-4000-8000-000000000201';
const MEMBER_B = '00000000-0000-4000-8000-000000000202';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expenseRecord(version: number, amount = '10000'): GroupExpenseResponse {
  return {
    id: EXPENSE,
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

function settlementRecord(version: number, amount = '2500'): SettlementResponse {
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

function expenseEdit(amount: string) {
  return {
    amount,
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'dinner',
    split: { mode: 'equal' as const, memberIds: [MEMBER_A, MEMBER_B] },
  };
}

const at = (n: number): Date => new Date(Date.UTC(2026, 9, 5, 12, 0, 0, n));

let database: IDBDatabase;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  database = await openLocalDatabase(ANA);
});

afterEach(() => {
  database.close();
});

describe('group queue: queueing and folding (DISC-001-04e Block 6)', () => {
  it('stores an edit with the base it was made on and revision 1', async () => {
    const written = await queueGroupUpdate(
      database,
      { kind: 'expense', base: expenseRecord(2), request: expenseEdit('12000') },
      at(1),
    );

    expect(written).toBe(true);
    const [record] = await loadGroupQueue(database);
    expect(record).toMatchObject({
      kind: 'expense',
      id: EXPENSE,
      groupId: GROUP,
      operation: 'update',
      revision: 1,
      base: { version: 2 },
      request: { amount: '12000' },
    });
    expect(record?.conflict).toBeUndefined();
  });

  it('folds a second edit into the record and keeps the oldest base', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });

    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(3, '99'),
      request: expenseEdit('13000'),
    });

    const queue = await loadGroupQueue(database);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      revision: 2,
      base: { version: 2, amount: '10000' },
      request: { amount: '13000' },
    });
  });

  it('a delete replaces a queued edit and keeps the oldest base', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });

    const written = await queueGroupDelete(database, { kind: 'expense', base: expenseRecord(4) });

    expect(written).toBe(true);
    const [record] = await loadGroupQueue(database);
    expect(record).toMatchObject({ operation: 'delete', revision: 2, base: { version: 2 } });
    expect(record?.request).toBeUndefined();
  });

  it('refuses an edit of a record that is queued for deletion', async () => {
    await queueGroupDelete(database, { kind: 'expense', base: expenseRecord(2) });

    const written = await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });

    expect(written).toBe(false);
    expect((await loadGroupQueue(database))[0]).toMatchObject({ operation: 'delete', revision: 1 });
  });

  it('keeps an expense and a settlement apart even with the same id', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(1),
      request: expenseEdit('12000'),
    });
    await queueGroupUpdate(database, {
      kind: 'settlement',
      base: { ...settlementRecord(1), id: EXPENSE },
      request: { amount: '3000' },
    });

    const queue = await loadGroupQueue(database);
    expect(queue.map((record) => record.kind).sort()).toEqual(['expense', 'settlement']);
  });

  it('refuses a request that does not pass the shared contract and stores nothing', async () => {
    await expect(
      queueGroupUpdate(database, {
        kind: 'expense',
        base: expenseRecord(1),
        request: expenseEdit('not-a-number'),
      }),
    ).rejects.toThrow();
    await expect(
      queueGroupUpdate(database, {
        kind: 'settlement',
        base: settlementRecord(1),
        request: {},
      }),
    ).rejects.toThrow();

    expect(await loadGroupQueue(database)).toEqual([]);
  });

  it('builds the request to send with the base version of the record', async () => {
    await queueGroupUpdate(database, {
      kind: 'settlement',
      base: settlementRecord(7),
      request: { amount: '3000' },
    });
    await queueGroupDelete(database, { kind: 'expense', base: expenseRecord(4) });

    const queue = await loadGroupQueue(database);
    const settlement = queue.find((record) => record.kind === 'settlement');
    const expense = queue.find((record) => record.kind === 'expense');

    expect(settlement && groupChangeBody(settlement)).toEqual({ amount: '3000', baseVersion: 7 });
    expect(expense && groupChangeBody(expense)).toBeUndefined();
  });

  it('leaves out, and never deletes, a stored record that does not parse', async () => {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(GROUP_QUEUE_STORE, 'readwrite');
      tx.objectStore(GROUP_QUEUE_STORE).put({ key: 'expense:broken', createdAt: 'x' });
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('write failed'));
      };
    });

    expect(await loadGroupQueue(database)).toEqual([]);
    const raw = await new Promise<unknown[]>((resolve) => {
      const request = database
        .transaction(GROUP_QUEUE_STORE)
        .objectStore(GROUP_QUEUE_STORE)
        .getAll();
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    expect(raw).toHaveLength(1);
  });
});

describe('group queue: conflict marking (FR-01, FR-03)', () => {
  async function queued() {
    await queueGroupUpdate(
      database,
      { kind: 'expense', base: expenseRecord(2), request: expenseEdit('12000') },
      at(1),
    );
  }

  it('a conflict keeps both the local request and the server record (AC-02)', async () => {
    await queued();
    const server = expenseRecord(5, '77000');

    const marked = await markGroupConflict(database, 'expense', EXPENSE, 1, server);

    expect(marked).toBe(true);
    const record = await readGroupChange(database, 'expense', EXPENSE);
    expect(record).toMatchObject({
      request: { amount: '12000' },
      base: { version: 2 },
      conflict: { server: { version: 5, amount: '77000' } },
    });
  });

  it('refuses to mark a record that changed meanwhile and leaves it untouched', async () => {
    await queued();
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('13000'),
    });

    const marked = await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5));

    expect(marked).toBe(false);
    const record = await readGroupChange(database, 'expense', EXPENSE);
    expect(record?.conflict).toBeUndefined();
    expect(record?.revision).toBe(2);
  });

  it('refuses to mark a record that is not queued, and a server record of another kind', async () => {
    expect(await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5))).toBe(false);

    await queued();
    await expect(
      markGroupConflict(database, 'expense', EXPENSE, 1, settlementRecord(5)),
    ).rejects.toThrow();
    expect((await readGroupChange(database, 'expense', EXPENSE))?.conflict).toBeUndefined();
  });

  it('counts pending, conflicts and failures apart, and a conflict is not pending', async () => {
    await queued();
    await queueGroupDelete(database, { kind: 'settlement', base: settlementRecord(1) });
    await queueGroupUpdate(database, {
      kind: 'settlement',
      base: { ...settlementRecord(1), id: MEMBER_A },
      request: { amount: '5' },
    });
    await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5));
    await markGroupRejected(database, 'settlement', SETTLEMENT, 'NOT_FOUND', 1);

    expect(await countGroupQueue(database)).toEqual({ pending: 1, conflict: 1, failed: 1 });
  });
});

describe('group queue: resolution (FR-02, FR-03)', () => {
  async function inConflict() {
    await queueGroupUpdate(
      database,
      { kind: 'expense', base: expenseRecord(2), request: expenseEdit('12000') },
      at(1),
    );
    await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5, '77000'));
  }

  it('keepMine rebases the record onto the server version and leaves it queued (AC-03)', async () => {
    await inConflict();

    await keepMine(database, 'expense', EXPENSE);

    const record = await readGroupChange(database, 'expense', EXPENSE);
    expect(record?.conflict).toBeUndefined();
    expect(record).toMatchObject({
      operation: 'update',
      request: { amount: '12000' },
      base: { version: 5, amount: '77000' },
      revision: 2,
    });
    expect(groupChangeBody(record as NonNullable<typeof record>)).toMatchObject({
      baseVersion: 5,
    });
    expect(await countGroupQueue(database)).toEqual({ pending: 1, conflict: 0, failed: 0 });
  });

  it('keepMine keeps a queued deletion a deletion', async () => {
    await queueGroupDelete(database, { kind: 'expense', base: expenseRecord(2) });
    await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5));

    await keepMine(database, 'expense', EXPENSE);

    expect(await readGroupChange(database, 'expense', EXPENSE)).toMatchObject({
      operation: 'delete',
      base: { version: 5 },
    });
  });

  it('keepServer removes the local change and stores the server copy (AC-02)', async () => {
    await inConflict();

    await keepServer(database, 'expense', EXPENSE);

    expect(await readGroupChange(database, 'expense', EXPENSE)).toBeUndefined();
    expect(await loadGroupQueue(database)).toEqual([]);
    expect(await readCachedGroupRecord(database, 'expense', EXPENSE)).toMatchObject({
      version: 5,
      amount: '77000',
    });
  });

  it('rejects resolving a record without a conflict and changes nothing', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });

    await expect(keepMine(database, 'expense', EXPENSE)).rejects.toBeInstanceOf(
      GroupResolutionRefused,
    );
    await expect(keepServer(database, 'expense', EXPENSE)).rejects.toBeInstanceOf(
      GroupResolutionRefused,
    );

    expect(await readGroupChange(database, 'expense', EXPENSE)).toMatchObject({ revision: 1 });
    expect(await readCachedGroupRecord(database, 'expense', EXPENSE)).toBeUndefined();
  });

  it('rejects resolving a record that is not queued', async () => {
    await expect(keepServer(database, 'settlement', SETTLEMENT)).rejects.toBeInstanceOf(
      GroupResolutionRefused,
    );
    await expect(keepMine(database, 'settlement', SETTLEMENT)).rejects.toBeInstanceOf(
      GroupResolutionRefused,
    );
  });

  it('an edit made while the conflict is open keeps the conflict', async () => {
    await inConflict();

    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('14000'),
    });

    expect(await readGroupChange(database, 'expense', EXPENSE)).toMatchObject({
      request: { amount: '14000' },
      conflict: { server: { version: 5 } },
      revision: 2,
    });
  });
});

describe('group queue: settling, rejecting and retrying', () => {
  it('settles a sent change only while it is still the revision that was sent', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('13000'),
    });

    await settleGroupSent(database, 'expense', EXPENSE, 1);
    expect(await readGroupChange(database, 'expense', EXPENSE)).toMatchObject({ revision: 2 });

    await settleGroupSent(database, 'expense', EXPENSE, 2);
    expect(await readGroupChange(database, 'expense', EXPENSE)).toBeUndefined();
  });

  it('flags a refused change, retry clears the flag and discard drops it', async () => {
    await queueGroupDelete(database, { kind: 'settlement', base: settlementRecord(1) });

    await markGroupRejected(database, 'settlement', SETTLEMENT, 'NOT_FOUND', 1);
    expect((await readGroupChange(database, 'settlement', SETTLEMENT))?.rejection).toEqual({
      code: 'NOT_FOUND',
    });

    expect(await retryGroupChange(database, 'settlement', SETTLEMENT)).toBe(true);
    expect((await readGroupChange(database, 'settlement', SETTLEMENT))?.rejection).toBeUndefined();
    expect(await retryGroupChange(database, 'settlement', SETTLEMENT)).toBe(false);

    expect(await discardGroupChange(database, 'settlement', SETTLEMENT)).toBe(true);
    expect(await discardGroupChange(database, 'settlement', SETTLEMENT)).toBe(false);
  });

  it('does not flag a record that changed since it was sent', async () => {
    await queueGroupDelete(database, { kind: 'settlement', base: settlementRecord(1) });
    await queueGroupUpdate(database, {
      kind: 'settlement',
      base: settlementRecord(1),
      request: { amount: '5' },
    }).catch(() => undefined);

    await markGroupRejected(database, 'settlement', SETTLEMENT, 'NOT_FOUND', 0);

    expect((await readGroupChange(database, 'settlement', SETTLEMENT))?.rejection).toBeUndefined();
  });
});

describe('group queue: persistence', () => {
  it('a queued record survives closing and reopening the database', async () => {
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });
    await markGroupConflict(database, 'expense', EXPENSE, 1, expenseRecord(5));
    database.close();

    database = await openLocalDatabase(ANA);

    expect(await readGroupChange(database, 'expense', EXPENSE)).toMatchObject({
      request: { amount: '12000' },
      conflict: { server: { version: 5 } },
    });
  });

  it('upgrades a version 2 database in place, keeping its stores and adding an empty group queue', async () => {
    database.close();
    globalThis.indexedDB = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${ANA}`, 2);
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        upgrading.createObjectStore(REFERENCE_STORE).put([{ id: 'a1' }], 'accounts');
        upgrading.createObjectStore('movements', { keyPath: 'id' });
        upgrading
          .createObjectStore(QUEUE_STORE, { keyPath: 'id' })
          .put({ id: 'q1', createdAt: '2026-10-02T12:00:01.000Z' });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('could not create the version 2 database'));
      };
    });

    database = await openLocalDatabase(ANA);

    expect(DATABASE_VERSION).toBe(3);
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      ['groupQueue', 'movements', 'queue', 'reference'].sort(),
    );
    expect(await loadGroupQueue(database)).toEqual([]);
    const kept = await new Promise<unknown>((resolve) => {
      const request = database.transaction(QUEUE_STORE).objectStore(QUEUE_STORE).get('q1');
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    expect(kept).toEqual({ id: 'q1', createdAt: '2026-10-02T12:00:01.000Z' });
  });

  it('withGroupQueue opens the user database, runs the work and closes it', async () => {
    const count = await withGroupQueue(ANA, async (db) => (await loadGroupQueue(db)).length);

    expect(count).toBe(0);
  });
});

/** A small deterministic generator, so a failing interruption can be replayed from its run number. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('group queue: atomic resolution under interruption (NFR-01)', () => {
  const RUNS = 1000;
  const SERVER = expenseRecord(5, '77000');

  async function rawWrite(work: (tx: IDBTransaction) => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction([GROUP_QUEUE_STORE, REFERENCE_STORE], 'readwrite');
      work(tx);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('write failed'));
      };
    });
  }

  async function reseed(): Promise<void> {
    await rawWrite((tx) => {
      tx.objectStore(GROUP_QUEUE_STORE).clear();
      tx.objectStore(REFERENCE_STORE).clear();
    });
    await queueGroupUpdate(database, {
      kind: 'expense',
      base: expenseRecord(2),
      request: expenseEdit('12000'),
    });
    await markGroupConflict(database, 'expense', EXPENSE, 1, SERVER);
  }

  /** Interrupts at a random step by throwing or by aborting the transaction, or not at all. */
  function interruption(random: () => number) {
    // Steps 0 to 2 exist; 3 never fires, so some runs complete.
    const step = Math.floor(random() * 4);
    const mode = random() < 0.5 ? 'throw' : 'abort';
    let fired = false;
    return {
      get fired() {
        return fired;
      },
      hooks: {
        onStep: (current: number, abort: () => void) => {
          if (current !== step) return;
          fired = true;
          if (mode === 'abort') abort();
          else throw new Error('interrupted');
        },
      },
    };
  }

  it('keepServer interrupted at a random step never leaves zero versions', async () => {
    const random = generator(0x5eed);
    let interrupted = 0;
    let completed = 0;

    for (let run = 0; run < RUNS; run += 1) {
      await reseed();
      const interrupt = interruption(random);

      const outcome = await keepServer(database, 'expense', EXPENSE, interrupt.hooks).then(
        () => 'done' as const,
        () => 'failed' as const,
      );

      const queued = await readGroupChange(database, 'expense', EXPENSE);
      const cached = await readCachedGroupRecord(database, 'expense', EXPENSE);
      if (outcome === 'failed') {
        interrupted += 1;
        // Both versions remain: the local request and the server copy, and nothing else changed.
        expect(queued, `run ${String(run)}`).toMatchObject({
          request: { amount: '12000' },
          conflict: { server: { version: 5 } },
        });
        expect(cached, `run ${String(run)}`).toBeUndefined();
      } else {
        completed += 1;
        // The chosen version is stored.
        expect(queued, `run ${String(run)}`).toBeUndefined();
        expect(cached, `run ${String(run)}`).toMatchObject({ version: 5, amount: '77000' });
      }
    }

    // The run must exercise both outcomes, or it proves nothing.
    expect(interrupted).toBeGreaterThan(RUNS / 4);
    expect(completed).toBeGreaterThan(RUNS / 10);
  });

  it('keepMine interrupted at a random step never leaves zero versions', async () => {
    const random = generator(0xc0ffee);
    let interrupted = 0;
    let completed = 0;

    for (let run = 0; run < RUNS; run += 1) {
      await reseed();
      const interrupt = interruption(random);

      const outcome = await keepMine(database, 'expense', EXPENSE, interrupt.hooks).then(
        () => 'done' as const,
        () => 'failed' as const,
      );

      const queued = await readGroupChange(database, 'expense', EXPENSE);
      expect(queued?.request, `run ${String(run)}`).toMatchObject({ amount: '12000' });
      if (outcome === 'failed') {
        interrupted += 1;
        expect(queued, `run ${String(run)}`).toMatchObject({
          base: { version: 2 },
          conflict: { server: { version: 5 } },
        });
      } else {
        completed += 1;
        expect(queued?.conflict, `run ${String(run)}`).toBeUndefined();
        expect(queued, `run ${String(run)}`).toMatchObject({ base: { version: 5 } });
      }
    }

    expect(interrupted).toBeGreaterThan(RUNS / 4);
    expect(completed).toBeGreaterThan(RUNS / 10);
  });
});
