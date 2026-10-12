import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FanOutNotices } from '../../src/push/application/fan-out-notices';
import { DrizzlePushFanOut } from '../../src/push/infrastructure/db/drizzle-push-fan-out';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
const NOW = new Date('2026-10-12T15:00:00.000Z');
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const fanOut = (): FanOutNotices =>
  new FanOutNotices(new DrizzlePushFanOut(connection.db), { now: () => NOW });

const user = (language: 'es' | 'en' = 'es'): Promise<string> =>
  seedUser(connection, {
    email: `u-${randomUUID()}@fan-out.test`,
    password: 'a long enough passphrase',
    language,
  });

async function subscribe(userId: string): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4) returning id`,
    [
      userId,
      `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      createECDH('prime256v1').generateKeys().toString('base64url'),
      randomBytes(16).toString('base64url'),
    ],
  );
  return result.rows[0]?.id ?? '';
}

async function notice(
  ownerId: string,
  options: { kind?: string; createdAt?: Date; read?: boolean } = {},
): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text, created_at, read_at)
     values ($1, $2, gen_random_uuid(), '2026-10-15', 'Luz vence mañana', $3, $4) returning id`,
    [
      ownerId,
      options.kind ?? 'reminder',
      options.createdAt ?? hoursAgo(1),
      options.read ? NOW : null,
    ],
  );
  return result.rows[0]?.id ?? '';
}

const deliveries = async (noticeId: string): Promise<number> =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from push_deliveries where notice_id = $1',
        [noticeId],
      )
    ).rows[0]?.n,
  );

const handled = async (noticeId: string): Promise<boolean> =>
  (
    await connection.pool.query<{ push_handled_at: Date | null }>(
      'select push_handled_at from notices where id = $1',
      [noticeId],
    )
  ).rows[0]?.push_handled_at != null;

describe('FanOutNotices', () => {
  it('creates one delivery per subscription of the owner (AC-14)', async () => {
    const owner = await user();
    await subscribe(owner);
    await subscribe(owner);
    const id = await notice(owner);

    await fanOut().execute();

    expect(await deliveries(id)).toBe(2);
    expect(await handled(id)).toBe(true);
  });

  it('is idempotent across runs, also when two run concurrently (AC-15)', async () => {
    const owner = await user();
    await subscribe(owner);
    await subscribe(owner);
    const ids = await Promise.all(Array.from({ length: 5 }, () => notice(owner)));

    await Promise.all([fanOut().execute(), fanOut().execute()]);
    await fanOut().execute();
    await fanOut().execute();

    for (const id of ids) expect(await deliveries(id)).toBe(2);
  });

  it('gives a subscription added later nothing for an already handled notice (AC-16)', async () => {
    const owner = await user();
    await subscribe(owner);
    const id = await notice(owner);
    await fanOut().execute();

    await subscribe(owner);
    await fanOut().execute();

    expect(await deliveries(id)).toBe(1);
  });

  it('skips budget_alert and delivers the other kinds (AC-17)', async () => {
    const owner = await user();
    await subscribe(owner);
    const alert = await notice(owner, { kind: 'budget_alert' });
    const others = await Promise.all(
      ['recorded', 'not_recorded', 'card_statement_due'].map((kind) => notice(owner, { kind })),
    );

    await fanOut().execute();

    expect(await deliveries(alert)).toBe(0);
    expect(await handled(alert)).toBe(true);
    for (const id of others) expect(await deliveries(id)).toBe(1);
  });

  it('skips notices older than 24 hours and read ones (AC-19)', async () => {
    const owner = await user();
    await subscribe(owner);
    const old = await notice(owner, { createdAt: hoursAgo(25) });
    const recent = await notice(owner, { createdAt: hoursAgo(23) });
    const read = await notice(owner, { read: true });

    await fanOut().execute();

    expect(await deliveries(old)).toBe(0);
    expect(await deliveries(recent)).toBe(1);
    expect(await deliveries(read)).toBe(0);
    expect(await handled(old)).toBe(true);
    expect(await handled(read)).toBe(true);
  });

  it('handles a notice of a user without subscriptions and leaves it unread (AC-20)', async () => {
    const owner = await user();
    const id = await notice(owner);

    await fanOut().execute();

    expect(await deliveries(id)).toBe(0);
    expect(await handled(id)).toBe(true);
    const row = await connection.pool.query<{ read_at: Date | null }>(
      'select read_at from notices where id = $1',
      [id],
    );
    expect(row.rows[0]?.read_at).toBeNull();
  });

  it('does not fan out the notice of one user to the subscription of another', async () => {
    const ana = await user();
    const bob = await user();
    await subscribe(bob);
    const id = await notice(ana);

    await fanOut().execute();

    expect(await deliveries(id)).toBe(0);
  });

  it('rolls the batch back on a storage error and handles it on the next run (FR-06)', async () => {
    const owner = await user();
    await subscribe(owner);
    const first = await notice(owner);
    const second = await notice(owner);
    const fn = `push_fail_${randomUUID().replaceAll('-', '')}`;
    await connection.pool.query(`
      create function ${fn}() returns trigger language plpgsql as $$
      begin
        if new.notice_id = '${second}' then raise exception 'boom'; end if;
        return new;
      end $$`);
    await connection.pool.query(
      `create trigger ${fn} before insert on push_deliveries for each row execute function ${fn}()`,
    );
    try {
      await expect(fanOut().execute()).rejects.toThrow();
      expect(await handled(first)).toBe(false);
      expect(await handled(second)).toBe(false);
      expect(await deliveries(first)).toBe(0);
    } finally {
      await connection.pool.query(`drop trigger ${fn} on push_deliveries`);
      await connection.pool.query(`drop function ${fn}()`);
    }

    await fanOut().execute();

    expect(await handled(first)).toBe(true);
    expect(await deliveries(second)).toBe(1);
  });

  it('returns counts only and loops over batches until one is smaller than the limit', async () => {
    const calls: number[] = [];
    const counts = await new FanOutNotices(
      {
        runBatch({ limit }) {
          calls.push(limit);
          return Promise.resolve(
            calls.length < 3 ? { examined: limit, deliveries: 2 } : { examined: 7, deliveries: 1 },
          );
        },
      },
      { now: () => NOW },
    ).execute();

    expect(calls).toEqual([500, 500, 500]);
    expect(counts).toEqual({ examined: 1007, deliveries: 5 });
  });
});
