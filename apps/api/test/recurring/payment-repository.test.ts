import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newMovement,
  readScope,
  writeScope,
} from '../movements/db-fixtures';
import { newRecurringOwner, rentOf } from './fixtures';

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

const count = async (statement: string, params: unknown[]): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};

const owner = () => newRecurringOwner(connection.db, connection.pool);

describe('DrizzleRecurringPaymentRepository', () => {
  it("answers ResourceNotFound when creating with another user's account or category", async () => {
    const ana = await owner();
    const bea = await owner();
    const scope = await writeScope(ana.ownerId);

    await expect(payments.create(scope, rentOf(ana, { accountId: bea.accountId }))).rejects.toThrow(
      ResourceNotFound,
    );
    await expect(
      payments.create(scope, rentOf(ana, { categoryId: bea.categoryId })),
    ).rejects.toThrow(ResourceNotFound);
    expect(await payments.count(scope)).toBe(0);
  });

  it("answers ResourceNotFound when updating to another user's account or category", async () => {
    const ana = await owner();
    const bea = await owner();
    const scope = await writeScope(ana.ownerId);
    const created = await payments.create(scope, rentOf(ana));

    await expect(payments.update(scope, created.id, { accountId: bea.accountId })).rejects.toThrow(
      ResourceNotFound,
    );
    await expect(
      payments.update(scope, created.id, { categoryId: bea.categoryId }),
    ).rejects.toThrow(ResourceNotFound);
    expect(await payments.get(scope, created.id)).toEqual(created);
  });

  it('stores the Rent payment and reads it back with bigint money (AC-01, NFR-01)', async () => {
    const ana = await owner();
    const scope = await writeScope(ana.ownerId);

    const created = await payments.create(scope, rentOf(ana));

    expect(created).toMatchObject({
      name: 'Rent',
      amount: 35000000n,
      frequency: 'monthly',
      dayOfMonth: 5,
      weekday: null,
      month: null,
      startDate: '2026-10-05',
      endDate: null,
      mode: 'confirmation',
      status: 'active',
      scheduleFrom: '2026-10-05',
      autoRecordingFrom: '2026-10-05',
    });
    expect(await payments.get(await readScope(ana.ownerId), created.id)).toEqual(created);
  });

  it('lists and counts only the caller payments, oldest first', async () => {
    const ana = await owner();
    const bea = await owner();
    const scope = await writeScope(ana.ownerId);
    const first = await payments.create(scope, rentOf(ana));
    const second = await payments.create(scope, rentOf(ana, { name: 'Gym' }));
    await payments.create(await writeScope(bea.ownerId), rentOf(bea));

    const listed = await payments.list(await readScope(ana.ownerId));

    expect(listed.map((payment) => payment.id)).toEqual([first.id, second.id]);
    expect(await payments.count(await readScope(ana.ownerId))).toBe(2);
    expect(await payments.count(await readScope(bea.ownerId))).toBe(1);
  });

  it('updates the given fields only', async () => {
    const ana = await owner();
    const scope = await writeScope(ana.ownerId);
    const created = await payments.create(scope, rentOf(ana));

    const updated = await payments.update(scope, created.id, { amount: 48250n, name: 'Rent 2' });

    expect(updated).toMatchObject({
      amount: 48250n,
      name: 'Rent 2',
      dayOfMonth: 5,
      status: 'active',
    });
  });

  it('pauses and resumes with the new schedule start (AC-13, AC-14)', async () => {
    const ana = await owner();
    const scope = await writeScope(ana.ownerId);
    const created = await payments.create(scope, rentOf(ana));

    const paused = await payments.setStatus(scope, created.id, {
      status: 'paused',
      scheduleFrom: '2026-10-05',
    });
    const resumed = await payments.setStatus(scope, created.id, {
      status: 'active',
      scheduleFrom: '2026-11-20',
    });

    expect(paused.status).toBe('paused');
    expect(resumed).toMatchObject({ status: 'active', scheduleFrom: '2026-11-20' });
  });

  it('stores autoRecordingFrom on create and moves it only when setStatus is given one (FR-05)', async () => {
    const ana = await owner();
    const scope = await writeScope(ana.ownerId);
    const created = await payments.create(scope, rentOf(ana, { autoRecordingFrom: '2026-10-09' }));

    const paused = await payments.setStatus(scope, created.id, {
      status: 'paused',
      scheduleFrom: '2026-10-05',
    });
    const resumed = await payments.setStatus(scope, created.id, {
      status: 'active',
      scheduleFrom: '2026-11-20',
      autoRecordingFrom: '2026-11-20',
    });

    expect(created.autoRecordingFrom).toBe('2026-10-09');
    expect(paused.autoRecordingFrom).toBe('2026-10-09');
    expect(resumed).toMatchObject({ scheduleFrom: '2026-11-20', autoRecordingFrom: '2026-11-20' });
    expect(await payments.get(await readScope(ana.ownerId), created.id)).toEqual(resumed);
  });

  it('sad path: a payment on an account or category of another user fails the composite key and answers not found (AC-02)', async () => {
    const ana = await owner();
    const bea = await owner();

    await expect(
      payments.create(await writeScope(ana.ownerId), rentOf(ana, { accountId: bea.accountId })),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      payments.create(await writeScope(ana.ownerId), rentOf(ana, { categoryId: bea.categoryId })),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(await payments.count(await readScope(ana.ownerId))).toBe(0);
  });

  it('sad path: get, update, setStatus and delete on another user rows raise ResourceNotFound and change nothing (AC-17)', async () => {
    const ana = await owner();
    const bea = await owner();
    const anas = await payments.create(await writeScope(ana.ownerId), rentOf(ana));
    const beaWrite = await writeScope(bea.ownerId);

    await expect(payments.get(await readScope(bea.ownerId), anas.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(payments.update(beaWrite, anas.id, { name: 'Hacked' })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      payments.setStatus(beaWrite, anas.id, {
        status: 'paused',
        scheduleFrom: '2026-10-05',
        autoRecordingFrom: '2026-10-05',
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(payments.delete(beaWrite, anas.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      payments.get(await readScope(bea.ownerId), '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect(await payments.get(await readScope(ana.ownerId), anas.id)).toEqual(anas);
  });

  it('deleting a payment removes its occurrences and leaves movements untouched (AC-15)', async () => {
    const ana = await owner();
    const scope = await writeScope(ana.ownerId);
    const created = await payments.create(scope, rentOf(ana));
    await occurrences.insertIgnore([
      { paymentId: created.id, ownerId: ana.ownerId, dueDate: '2026-10-05' },
    ]);
    await newMovement(connection.pool, {
      ownerId: ana.ownerId,
      accountId: ana.accountId,
      categoryId: ana.categoryId,
      type: 'expense',
      amount: 100n,
    });

    await payments.delete(scope, created.id);

    expect(
      await count('select count(*) as n from recurring_occurrences where owner_id = $1', [
        ana.ownerId,
      ]),
    ).toBe(0);
    expect(
      await count('select count(*) as n from recurring_payments where owner_id = $1', [
        ana.ownerId,
      ]),
    ).toBe(0);
    expect(
      await count('select count(*) as n from movements where owner_id = $1', [ana.ownerId]),
    ).toBe(1);
  });

  it('the database refuses an account or category delete while a payment uses it', async () => {
    const ana = await owner();
    await payments.create(await writeScope(ana.ownerId), rentOf(ana));
    const spareAccount = await newAccount(connection.pool, ana.ownerId);
    const spareCategory = await newCategory(connection.pool, ana.ownerId, 'expense');

    await expect(
      connection.pool.query('delete from accounts where id = $1', [ana.accountId]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      connection.pool.query('delete from categories where id = $1', [ana.categoryId]),
    ).rejects.toMatchObject({ code: '23503' });
    await connection.pool.query('delete from accounts where id = $1', [spareAccount]);
    await connection.pool.query('delete from categories where id = $1', [spareCategory]);
  });
});
