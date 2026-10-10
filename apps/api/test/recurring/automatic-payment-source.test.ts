import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AutomaticPaymentEntry } from '../../src/recurring/application/ports/automatic-payment-source';
import { DrizzleAutomaticPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-automatic-payment-source';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { writeScope } from '../movements/db-fixtures';
import { newRecurringOwner, rentOf } from './fixtures';

let connection: DatabaseConnection;
let payments: DrizzleRecurringPaymentRepository;
let source: DrizzleAutomaticPaymentSource;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  payments = new DrizzleRecurringPaymentRepository(connection.db);
  source = new DrizzleAutomaticPaymentSource(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function readAll(limit: number): Promise<AutomaticPaymentEntry[]> {
  const all: AutomaticPaymentEntry[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page: AutomaticPaymentEntry[] = await source.page(afterId, limit);
    expect(page.length).toBeLessThanOrEqual(limit);
    all.push(...page);
    const last = page[page.length - 1];
    if (page.length < limit || !last) return all;
    afterId = last.payment.id;
  }
}

describe('DrizzleAutomaticPaymentSource', () => {
  it('pages by keyset and returns only active automatic payments of existing users (AC-11)', async () => {
    const ana = await newRecurringOwner(connection.db, connection.pool);
    const bea = await newRecurringOwner(connection.db, connection.pool);
    await connection.pool.query("update users set time_zone = 'Asia/Tokyo' where id = $1", [
      bea.ownerId,
    ]);
    const scopeAna = await writeScope(ana.ownerId);
    const scopeBea = await writeScope(bea.ownerId);
    const auto = { mode: 'automatic' as const };
    const anaAuto = await payments.create(scopeAna, rentOf(ana, auto));
    const anaAuto2 = await payments.create(scopeAna, rentOf(ana, { ...auto, name: 'Gym' }));
    const beaAuto = await payments.create(scopeBea, rentOf(bea, auto));
    const confirmation = await payments.create(scopeAna, rentOf(ana, { name: 'Ask me' }));
    const paused = await payments.create(scopeAna, rentOf(ana, { ...auto, name: 'Paused' }));
    await payments.setStatus(scopeAna, paused.id, { status: 'paused', scheduleFrom: '2026-10-05' });
    const deleted = await payments.create(scopeBea, rentOf(bea, { ...auto, name: 'Gone' }));
    await payments.delete(scopeBea, deleted.id);

    const all = await readAll(2);

    const ids = all.map((entry) => entry.payment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toEqual(expect.arrayContaining([anaAuto.id, anaAuto2.id, beaAuto.id]));
    expect(ids).not.toContain(confirmation.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(deleted.id);
    const byId = new Map(all.map((entry) => [entry.payment.id, entry]));
    expect(byId.get(anaAuto.id)).toMatchObject({
      ownerId: ana.ownerId,
      timeZone: 'America/Cordoba',
    });
    expect(byId.get(beaAuto.id)).toMatchObject({ ownerId: bea.ownerId, timeZone: 'Asia/Tokyo' });
    expect(byId.get(beaAuto.id)?.payment).toMatchObject({
      amount: 35000000n,
      mode: 'automatic',
      status: 'active',
      autoRecordingFrom: '2026-10-05',
      scheduleFrom: '2026-10-05',
    });
  });

  it('starts after the given id and honors the limit', async () => {
    const ana = await newRecurringOwner(connection.db, connection.pool);
    const scope = await writeScope(ana.ownerId);
    const created = [];
    for (const name of ['A', 'B', 'C']) {
      created.push(await payments.create(scope, rentOf(ana, { mode: 'automatic', name })));
    }
    const sorted = created.map((payment) => payment.id).sort();

    const page = await source.page(sorted[0] ?? null, 1000);

    const ids = page.map((entry) => entry.payment.id);
    expect(ids).not.toContain(sorted[0]);
    expect(ids).toEqual(expect.arrayContaining(sorted.slice(1)));
    expect(await source.page(null, 1)).toHaveLength(1);
  });

  it('sad path: returns nothing after the largest id', async () => {
    expect(await source.page('ffffffff-ffff-4fff-8fff-ffffffffffff', 10)).toEqual([]);
  });
});
