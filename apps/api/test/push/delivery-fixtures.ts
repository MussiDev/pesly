import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { DeliverDuePushes } from '../../src/push/application/deliver-due-pushes';
import { createLimiter } from '../../src/push/application/limit-concurrency';
import { DrizzlePushDeliveryQueue } from '../../src/push/infrastructure/db/drizzle-push-delivery-queue';
import type { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { seedUser } from '../helpers/session-client';

export const NOW = new Date('2026-10-12T15:00:00.000Z');

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
}

export function capturingLogger(lines: LogLine[]) {
  const at =
    (level: LogLine['level']) =>
    (fields: Record<string, unknown>, message: string): void => {
      lines.push({ level, fields, message });
    };
  return { info: at('info'), warn: at('warn'), error: at('error') };
}

export const newUser = (
  connection: DatabaseConnection,
  language: 'es' | 'en' = 'es',
): Promise<string> =>
  seedUser(connection, {
    email: `u-${randomUUID()}@delivery.test`,
    password: 'a long enough passphrase',
    language,
  });

export async function subscribe(
  connection: DatabaseConnection,
  userId: string,
): Promise<{ id: string; endpoint: string }> {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const result = await connection.pool.query<{ id: string }>(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4) returning id`,
    [
      userId,
      endpoint,
      createECDH('prime256v1').generateKeys().toString('base64url'),
      randomBytes(16).toString('base64url'),
    ],
  );
  return { id: result.rows[0]?.id ?? '', endpoint };
}

export async function notice(
  connection: DatabaseConnection,
  ownerId: string,
  options: { kind?: string; read?: boolean; text?: string } = {},
): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text, created_at, read_at)
     values ($1, $2, gen_random_uuid(), '2026-10-15', $3, $4, $5) returning id`,
    [
      ownerId,
      options.kind ?? 'reminder',
      options.text ?? 'Luz vence manana',
      new Date(NOW.getTime() - 3_600_000),
      options.read ? NOW : null,
    ],
  );
  return result.rows[0]?.id ?? '';
}

export async function delivery(
  connection: DatabaseConnection,
  noticeId: string,
  subscriptionId: string,
  overrides: { nextAttemptAt?: Date } = {},
): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into push_deliveries (notice_id, subscription_id, next_attempt_at)
     values ($1, $2, $3) returning id`,
    [noticeId, subscriptionId, overrides.nextAttemptAt ?? new Date(NOW.getTime() - 1000)],
  );
  return result.rows[0]?.id ?? '';
}

export interface DeliveryRow {
  status: string;
  attempts: number;
  next_attempt_at: Date;
  lease_until: Date | null;
  sent_at: Date | null;
}

export async function deliveryRow(
  connection: DatabaseConnection,
  id: string,
): Promise<DeliveryRow | undefined> {
  return (
    await connection.pool.query<DeliveryRow>(
      'select status, attempts, next_attempt_at, lease_until, sent_at from push_deliveries where id = $1',
      [id],
    )
  ).rows[0];
}

export function build(
  connection: DatabaseConnection,
  provider: FakePushProvider,
  options: { now?: () => Date; lines?: LogLine[]; limiter?: ReturnType<typeof createLimiter> } = {},
): DeliverDuePushes {
  return new DeliverDuePushes({
    queue: new DrizzlePushDeliveryQueue(connection.db),
    provider,
    clock: { now: options.now ?? (() => NOW) },
    logger: capturingLogger(options.lines ?? []),
    limiter: options.limiter ?? createLimiter(20),
  });
}
