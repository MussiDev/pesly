import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReminderEntry } from '../../src/recurring/application/ports/reminder-payment-source';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { DrizzleReminderPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-reminder-payment-source';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { writeScope } from '../movements/db-fixtures';
import { newRecurringOwner, rentOf } from './fixtures';

let connection: DatabaseConnection;
let payments: DrizzleRecurringPaymentRepository;
let occurrences: DrizzleOccurrenceRepository;
let source: DrizzleReminderPaymentSource;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  payments = new DrizzleRecurringPaymentRepository(connection.db);
  occurrences = new DrizzleOccurrenceRepository(connection.db);
  source = new DrizzleReminderPaymentSource(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function readAll(limit: number): Promise<ReminderEntry[]> {
  const all: ReminderEntry[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page: ReminderEntry[] = await source.page(afterId, limit);
    expect(page.length).toBeLessThanOrEqual(limit);
    all.push(...page);
    const last = page[page.length - 1];
    if (page.length < limit || !last) return all;
    afterId = last.payment.id;
  }
}

describe('DrizzleReminderPaymentSource', () => {
  it('pages by keyset and returns active payments of any mode with zone and language', async () => {
    const ana = await newRecurringOwner(connection.db, connection.pool);
    const bea = await newRecurringOwner(connection.db, connection.pool);
    await connection.pool.query(
      "update users set time_zone = 'Asia/Tokyo', language = 'en' where id = $1",
      [bea.ownerId],
    );
    const scopeAna = await writeScope(ana.ownerId);
    const scopeBea = await writeScope(bea.ownerId);
    const anaConfirmation = await payments.create(scopeAna, rentOf(ana));
    const anaAutomatic = await payments.create(
      scopeAna,
      rentOf(ana, { name: 'Gym', mode: 'automatic' }),
    );
    const beaConfirmation = await payments.create(scopeBea, rentOf(bea, { reminderDays: 7 }));
    const paused = await payments.create(scopeAna, rentOf(ana, { name: 'Paused' }));
    await payments.setStatus(scopeAna, paused.id, { status: 'paused', scheduleFrom: '2026-10-05' });
    const deleted = await payments.create(scopeBea, rentOf(bea, { name: 'Gone' }));
    await payments.delete(scopeBea, deleted.id);

    const all = await readAll(2);

    const ids = all.map((entry) => entry.payment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(
      expect.arrayContaining([anaConfirmation.id, anaAutomatic.id, beaConfirmation.id]),
    );
    const byId = new Map(all.map((entry) => [entry.payment.id, entry]));
    expect(byId.get(anaConfirmation.id)).toMatchObject({
      ownerId: ana.ownerId,
      timeZone: 'America/Cordoba',
      language: 'es',
    });
    expect(byId.get(beaConfirmation.id)).toMatchObject({
      ownerId: bea.ownerId,
      timeZone: 'Asia/Tokyo',
      language: 'en',
    });
    expect(byId.get(beaConfirmation.id)?.payment).toMatchObject({
      mode: 'confirmation',
      reminderDays: 7,
      autoRecordingFrom: '2026-10-05',
    });
  });

  it('starts after the given id and an empty table gives an empty page', async () => {
    expect(await source.page(null, 10)).toEqual([]);
    const owner = await newRecurringOwner(connection.db, connection.pool);
    const scope = await writeScope(owner.ownerId);
    const first = await payments.create(scope, rentOf(owner, { name: 'A' }));
    const second = await payments.create(scope, rentOf(owner, { name: 'B' }));
    const [low, high] = [first.id, second.id].sort();

    const page = await source.page(low ?? '', 10);

    expect(page.map((entry) => entry.payment.id)).toEqual([high]);
  });

  it('is not reachable from the module index', () => {
    const index = readFileSync(new URL('../../src/recurring/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/reminder/);
  });
});

describe('DrizzleOccurrenceRepository.listResolvedDueDates', () => {
  async function resolved(ownerId: string, paymentId: string, dueDate: string, how: string) {
    await occurrences.insertIgnore([{ paymentId, ownerId, dueDate }]);
    if (how === 'pending') return;
    const [row] = await connection.pool
      .query<{ id: string }>(
        'select id from recurring_occurrences where payment_id = $1 and due_date = $2',
        [paymentId, dueDate],
      )
      .then((result) => result.rows);
    const scope = await writeScope(ownerId);
    await occurrences.withLockedPending(scope, row?.id ?? '', () =>
      Promise.resolve(
        how === 'skipped'
          ? { status: 'skipped' as const }
          : { status: 'confirmed' as const, confirmedAmount: 1n, movementId: crypto.randomUUID() },
      ),
    );
  }

  it('returns the confirmed and skipped due dates of the given payments inside the window', async () => {
    const owner = await newRecurringOwner(connection.db, connection.pool);
    const scope = await writeScope(owner.ownerId);
    const one = await payments.create(scope, rentOf(owner, { name: 'One' }));
    const two = await payments.create(scope, rentOf(owner, { name: 'Two' }));
    const other = await payments.create(scope, rentOf(owner, { name: 'Other' }));
    await resolved(owner.ownerId, one.id, '2026-10-10', 'confirmed');
    await resolved(owner.ownerId, one.id, '2026-10-11', 'pending');
    await resolved(owner.ownerId, one.id, '2026-12-01', 'skipped');
    await resolved(owner.ownerId, two.id, '2026-10-12', 'skipped');
    await resolved(owner.ownerId, other.id, '2026-10-10', 'confirmed');

    const found = await occurrences.listResolvedDueDates(
      [one.id, two.id],
      '2026-10-01',
      '2026-11-30',
    );

    expect(found).toHaveLength(2);
    expect(found).toEqual(
      expect.arrayContaining([
        { paymentId: one.id, dueDate: '2026-10-10' },
        { paymentId: two.id, dueDate: '2026-10-12' },
      ]),
    );
  });

  it('an empty list of payments gives an empty result', async () => {
    expect(await occurrences.listResolvedDueDates([], '2026-10-01', '2026-11-30')).toEqual([]);
  });
});
