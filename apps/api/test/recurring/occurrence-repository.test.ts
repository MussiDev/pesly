import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OccurrenceNotPending } from '../../src/recurring/domain/errors';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { readScope, writeScope } from '../movements/db-fixtures';
import { newRecurringOwner, rentOf, type RecurringOwner } from './fixtures';

let connection: DatabaseConnection;
let payments: DrizzleRecurringPaymentRepository;
let occurrences: DrizzleOccurrenceRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  payments = new DrizzleRecurringPaymentRepository(connection.db);
  occurrences = new DrizzleOccurrenceRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const MOVEMENT_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const skip = () => Promise.resolve({ status: 'skipped' as const });

async function rent(): Promise<{ ana: RecurringOwner; paymentId: string }> {
  const ana = await newRecurringOwner(connection.db, connection.pool);
  const created = await payments.create(await writeScope(ana.ownerId), rentOf(ana));
  return { ana, paymentId: created.id };
}

const rowsOf = async (paymentId: string) =>
  (
    await connection.pool.query<{ due_date: string; status: string }>(
      "select to_char(due_date, 'YYYY-MM-DD') as due_date, status from recurring_occurrences where payment_id = $1 order by due_date",
      [paymentId],
    )
  ).rows;

describe('DrizzleOccurrenceRepository.insertIgnore', () => {
  it('stores one row per payment and due date when called twice (NFR-03, AC-06)', async () => {
    const { ana, paymentId } = await rent();
    const rows = [
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' },
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-11-05' },
    ];

    await occurrences.insertIgnore(rows);
    await occurrences.insertIgnore(rows);

    expect(await rowsOf(paymentId)).toEqual([
      { due_date: '2026-10-05', status: 'pending' },
      { due_date: '2026-11-05', status: 'pending' },
    ]);
  });

  it('stores one row when called concurrently (NFR-03, AC-06)', async () => {
    const { ana, paymentId } = await rent();
    const rows = [{ paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' }];

    await Promise.all(Array.from({ length: 8 }, () => occurrences.insertIgnore(rows)));

    expect(await rowsOf(paymentId)).toHaveLength(1);
  });

  it('does nothing for an empty list', async () => {
    await expect(occurrences.insertIgnore([])).resolves.toBeUndefined();
  });

  it('sad path: a row whose owner is not the payment owner fails the composite key', async () => {
    const { paymentId } = await rent();
    const bea = await newRecurringOwner(connection.db, connection.pool);

    await expect(
      occurrences.insertIgnore([{ paymentId, ownerId: bea.ownerId, dueDate: '2026-10-05' }]),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});

describe('DrizzleOccurrenceRepository.listPending and deletePendingFor', () => {
  it('lists only the caller pending rows ordered by due date', async () => {
    const { ana, paymentId } = await rent();
    const other = await rent();
    await occurrences.insertIgnore([
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-11-05' },
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' },
      { paymentId: other.paymentId, ownerId: other.ana.ownerId, dueDate: '2026-10-05' },
    ]);

    const listed = await occurrences.listPending(await readScope(ana.ownerId));

    expect(listed.map((item) => item.dueDate)).toEqual(['2026-10-05', '2026-11-05']);
    expect(listed.every((item) => item.paymentId === paymentId && item.status === 'pending')).toBe(
      true,
    );
    expect(listed[0]).toMatchObject({ confirmedAmount: null, movementId: null, resolvedAt: null });
  });

  it('deletes pending rows of one payment and keeps resolved ones (AC-12)', async () => {
    const { ana, paymentId } = await rent();
    const scope = await writeScope(ana.ownerId);
    await occurrences.insertIgnore([
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' },
      { paymentId, ownerId: ana.ownerId, dueDate: '2026-11-05' },
    ]);
    const [first] = await occurrences.listPending(scope);
    if (!first) throw new Error('No occurrence');
    await occurrences.withLockedPending(scope, first.id, skip);

    await occurrences.deletePendingFor(scope, paymentId);

    expect(await rowsOf(paymentId)).toEqual([{ due_date: '2026-10-05', status: 'skipped' }]);
  });

  it('sad path: deletePendingFor with another user scope deletes nothing', async () => {
    const { ana, paymentId } = await rent();
    const bea = await newRecurringOwner(connection.db, connection.pool);
    await occurrences.insertIgnore([{ paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' }]);

    await occurrences.deletePendingFor(await writeScope(bea.ownerId), paymentId);

    expect(await rowsOf(paymentId)).toHaveLength(1);
  });
});

describe('DrizzleOccurrenceRepository.withLockedPending', () => {
  async function pendingOccurrence() {
    const { ana, paymentId } = await rent();
    await occurrences.insertIgnore([{ paymentId, ownerId: ana.ownerId, dueDate: '2026-10-05' }]);
    const scope = await writeScope(ana.ownerId);
    const [occurrence] = await occurrences.listPending(scope);
    if (!occurrence) throw new Error('No occurrence');
    return { paymentId, scope, occurrence };
  }

  it('confirms with amount and movement id and returns the updated row (AC-07)', async () => {
    const { scope, occurrence } = await pendingOccurrence();

    const result = await occurrences.withLockedPending(scope, occurrence.id, (locked) => {
      expect(locked.id).toBe(occurrence.id);
      return Promise.resolve({
        status: 'confirmed' as const,
        confirmedAmount: 4825000n,
        movementId: MOVEMENT_ID,
      });
    });

    expect(result).toMatchObject({
      id: occurrence.id,
      status: 'confirmed',
      confirmedAmount: 4825000n,
      movementId: MOVEMENT_ID,
    });
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(await occurrences.listPending(scope)).toEqual([]);
  });

  it('skips without a movement (AC-09)', async () => {
    const { scope, occurrence } = await pendingOccurrence();

    const result = await occurrences.withLockedPending(scope, occurrence.id, skip);

    expect(result).toMatchObject({ status: 'skipped', confirmedAmount: null, movementId: null });
  });

  it('sad path: a resolved row raises OccurrenceNotPending and fn never runs (AC-08)', async () => {
    const { scope, occurrence } = await pendingOccurrence();
    await occurrences.withLockedPending(scope, occurrence.id, skip);
    let ran = false;

    await expect(
      occurrences.withLockedPending(scope, occurrence.id, () => {
        ran = true;
        return skip();
      }),
    ).rejects.toBeInstanceOf(OccurrenceNotPending);
    expect(ran).toBe(false);
  });

  it('sad path: an error thrown inside fn leaves the row pending (AC-08)', async () => {
    const { scope, occurrence, paymentId } = await pendingOccurrence();

    await expect(
      occurrences.withLockedPending(scope, occurrence.id, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(await rowsOf(paymentId)).toEqual([{ due_date: '2026-10-05', status: 'pending' }]);
  });

  it('sad path: two concurrent confirms resolve once and the other sees OccurrenceNotPending', async () => {
    const { scope, occurrence } = await pendingOccurrence();
    const confirm = () =>
      occurrences.withLockedPending(scope, occurrence.id, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { status: 'confirmed' as const, confirmedAmount: 1n, movementId: MOVEMENT_ID };
      });

    const results = await Promise.allSettled([confirm(), confirm()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(OccurrenceNotPending);
  });

  it('sad path: another user row or a missing id raises ResourceNotFound and changes nothing (AC-17)', async () => {
    const { occurrence, paymentId } = await pendingOccurrence();
    const bea = await newRecurringOwner(connection.db, connection.pool);
    const beaScope = await writeScope(bea.ownerId);
    let ran = false;
    const run = (id: string) =>
      occurrences.withLockedPending(beaScope, id, () => {
        ran = true;
        return skip();
      });

    await expect(run(occurrence.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(run(MISSING_ID)).rejects.toBeInstanceOf(ResourceNotFound);

    expect(ran).toBe(false);
    expect(await rowsOf(paymentId)).toEqual([{ due_date: '2026-10-05', status: 'pending' }]);
  });
});

describe('DrizzleOccurrenceRepository.listRecordable', () => {
  it('lists only the pending rows of the payment inside the window, oldest first, owner scoped', async () => {
    const { ana, paymentId } = await rent();
    const bea = await newRecurringOwner(connection.db, connection.pool);
    await occurrences.insertIgnore(
      ['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'].map((dueDate) => ({
        paymentId,
        ownerId: ana.ownerId,
        dueDate,
      })),
    );
    const scope = await writeScope(ana.ownerId);
    const [september] = await occurrences.listRecordable(
      scope,
      paymentId,
      '2026-09-05',
      '2026-09-05',
    );
    await occurrences.withLockedPending(scope, september?.id ?? MISSING_ID, skip);

    const listed = await occurrences.listRecordable(scope, paymentId, '2026-09-01', '2026-10-31');
    const foreign = await occurrences.listRecordable(
      await writeScope(bea.ownerId),
      paymentId,
      '2026-01-01',
      '2026-12-31',
    );

    expect(listed.map((row) => row.dueDate)).toEqual(['2026-10-05']);
    expect(listed[0]).toMatchObject({ paymentId, status: 'pending', movementId: null });
    expect(foreign).toEqual([]);
  });
});
