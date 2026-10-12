import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DueDelivery } from '../../src/push/application/ports/push-delivery-queue';
import { DeliverDuePushes } from '../../src/push/application/deliver-due-pushes';
import { createLimiter } from '../../src/push/application/limit-concurrency';
import { DrizzlePushDeliveryQueue } from '../../src/push/infrastructure/db/drizzle-push-delivery-queue';
import { DrizzlePushSubscriptionRepository } from '../../src/push/infrastructure/db/drizzle-push-subscription-repository';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { writeScope } from '../movements/db-fixtures';
import {
  capturingLogger,
  delivery,
  deliveryRow,
  newUser,
  notice,
  NOW,
  subscribe,
} from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

/** Runs a hook right after the claim, i.e. between the claim and the send. */
class HookedQueue extends DrizzlePushDeliveryQueue {
  constructor(
    private readonly afterClaim: () => Promise<void>,
    db: DatabaseConnection['db'],
  ) {
    super(db);
  }
  override async claimDue(now: Date, limit: number): Promise<DueDelivery[]> {
    const rows = await super.claimDue(now, limit);
    if (rows.length > 0) await this.afterClaim();
    return rows;
  }
}

describe('send-time guards', () => {
  it('skips the delivery when another user took the endpoint after the claim', async () => {
    const a = await newUser(connection);
    const b = await newUser(connection);
    const sub = await subscribe(connection, a);
    const noticeId = await notice(connection, a);
    const id = await delivery(connection, noticeId, sub.id);
    const provider = new FakePushProvider();
    const queue = new HookedQueue(async () => {
      await connection.pool.query('update push_subscriptions set user_id = $1 where id = $2', [
        b,
        sub.id,
      ]);
    }, connection.db);
    await new DeliverDuePushes({
      queue,
      provider,
      clock: { now: () => NOW },
      logger: capturingLogger([]),
      limiter: createLimiter(5),
    }).execute();
    expect(provider.sent).toHaveLength(0);
    expect((await deliveryRow(connection, id))?.status).toBe('skipped');
  });

  it('skips a delivery whose notice is older than 24 hours at send time', async () => {
    const u = await newUser(connection);
    const sub = await subscribe(connection, u);
    const stale = await notice(connection, u, { ageMs: 24 * 3_600_000 + 60_000 });
    const fresh = await notice(connection, u, { ageMs: 23 * 3_600_000 });
    const staleId = await delivery(connection, stale, sub.id);
    const freshId = await delivery(connection, fresh, sub.id);
    const provider = new FakePushProvider();
    await new DeliverDuePushes({
      queue: new DrizzlePushDeliveryQueue(connection.db),
      provider,
      clock: { now: () => NOW },
      logger: capturingLogger([]),
      limiter: createLimiter(5),
    }).execute();
    expect((await deliveryRow(connection, staleId))?.status).toBe('skipped');
    expect((await deliveryRow(connection, freshId))?.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
  });
});

describe('push constants', () => {
  it('are defined once, in packages/shared', () => {
    const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
    const files = [
      '../../src/push/application/deliver-due-pushes.ts',
      '../../src/push/domain/push-payload.ts',
      '../../src/push/infrastructure/db/drizzle-push-delivery-queue.ts',
    ].map(read);
    for (const source of files) {
      expect(source).not.toMatch(/(PUSH_TTL_SECONDS|PUSH_PAYLOAD_MAX_BYTES|MAX_ATTEMPTS)\s*=/);
    }
  });
});

describe('subscription cap eviction', () => {
  it('a store that waited on the per-user lock does not evict its own row', async () => {
    const userId = await newUser(connection);
    const key = () => ({
      p256dh: randomBytes(65).toString('base64url').slice(0, 87).padEnd(87, 'A'),
      auth: randomBytes(16).toString('base64url').slice(0, 22),
    });
    const mk = (endpoint: string) => ({ endpoint, ...key() });
    const repo = new DrizzlePushSubscriptionRepository(connection.db);
    const scope = await writeScope(userId);

    const holder = await connection.pool.connect();
    await holder.query('begin');
    await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    const ownEndpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    const waiting = repo.store(scope, mk(ownEndpoint));
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 10; i++) {
      await holder.query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
         values ($1, $2, $3, $4, clock_timestamp())`,
        [userId, `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, key().p256dh, key().auth],
      );
    }
    await holder.query('commit');
    holder.release();
    await waiting;

    const rows = await connection.pool.query(
      'select endpoint from push_subscriptions where user_id = $1',
      [userId],
    );
    expect(rows.rows).toHaveLength(10);
    expect(rows.rows.map((r: { endpoint: string }) => r.endpoint)).toContain(ownEndpoint);
  });
});
