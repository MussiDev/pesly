import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushOutcome, PushProvider } from '../../src/push/application/ports/push-provider';
import { createPushJob } from '../../src/push/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { delivery, newUser, notice, NOW, subscribe } from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

function capture(): { write: (chunk: string) => void; raw: string[] } {
  const raw: string[] = [];
  return {
    raw,
    write: (chunk: string) => {
      raw.push(chunk);
    },
  };
}

const PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';

describe('logger redaction (NFR-07)', () => {
  it('redacts endpoint, p256dh, authSecret, vapidPrivateKey and body.keys.auth, top level and nested', () => {
    const sink = capture();
    const logger = createLogger({ level: 'info', destination: sink });
    const secret = 'SECRET-VALUE-123';
    logger.info(
      { endpoint: secret, p256dh: secret, authSecret: secret, vapidPrivateKey: secret },
      'a',
    );
    logger.info(
      {
        subscription: { endpoint: secret, p256dh: secret, authSecret: secret },
        settings: { vapidPrivateKey: secret },
      },
      'b',
    );
    logger.info({ body: { keys: { auth: secret, p256dh: secret }, endpoint: secret } }, 'c');
    logger.info({ req: { body: { keys: { auth: secret } } } }, 'd');
    expect(sink.raw).toHaveLength(4);
    for (const line of sink.raw) {
      expect(line).not.toContain(secret);
      expect(line).toContain('[REDACTED]');
    }
  });

  it('keeps the ids and the status code that the push code logs', () => {
    const sink = capture();
    createLogger({ destination: sink }).info(
      { deliveryId: 'd1', noticeId: 'n1', statusCode: 403 },
      'x',
    );
    expect(sink.raw[0]).toContain('"deliveryId":"d1"');
    expect(sink.raw[0]).toContain('"statusCode":403');
  });
});

describe('a full job run leaves no secret in any log line', () => {
  it('never logs the push URL, keys, the VAPID private key or the notice text', async () => {
    const userId = await newUser(connection);
    const sub = await subscribe(connection, userId);
    const text = 'Texto-del-aviso-unico';
    const noticeId = await notice(connection, userId, { text });
    await delivery(connection, noticeId, sub.id);
    const keys = await connection.pool.query<{ p256dh: string; auth: string }>(
      'select p256dh, auth from push_subscriptions where id = $1',
      [sub.id],
    );
    const sink = capture();
    const logger = createLogger({ level: 'debug', destination: sink });
    logger.info({ vapidPrivateKey: PRIVATE_KEY }, 'config check');
    const throwing: PushProvider = {
      send: (message): Promise<PushOutcome> =>
        Promise.reject(new Error(`fetch failed ${message.target.pushUrl} ${PRIVATE_KEY}`)),
    };
    const job = createPushJob({
      db: connection.db,
      logger,
      provider: throwing,
      intervalSeconds: 10,
      clock: { now: () => NOW },
    });
    await job.runOnce();
    const all = sink.raw.join('\n');
    expect(all).toContain(noticeId);
    expect(all).toContain('Error');
    for (const forbidden of [
      sub.endpoint,
      'fcm.googleapis.com',
      keys.rows[0]?.p256dh ?? 'x',
      keys.rows[0]?.auth ?? 'x',
      PRIVATE_KEY,
      text,
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('logs the delivery id, the notice id and the status code of a rejected send', async () => {
    const userId = await newUser(connection);
    const sub = await subscribe(connection, userId);
    const noticeId = await notice(connection, userId);
    const deliveryId = await delivery(connection, noticeId, sub.id);
    const sink = capture();
    const rejecting: PushProvider = {
      send: (): Promise<PushOutcome> => Promise.resolve({ kind: 'rejected', status: 403 }),
    };
    await createPushJob({
      db: connection.db,
      logger: createLogger({ level: 'debug', destination: sink }),
      provider: rejecting,
      intervalSeconds: 10,
      clock: { now: () => NOW },
    }).runOnce();
    const line = sink.raw
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((entry) => entry.deliveryId === deliveryId);
    expect(line).toMatchObject({ deliveryId, noticeId });
    expect(JSON.stringify(line)).toContain('403');
  });
});

describe('logger redaction of pushUrl', () => {
  it('redacts pushUrl at the top level and nested', () => {
    const raw: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (c: string) => void raw.push(c) },
    });
    const secret = 'https://fcm.googleapis.com/fcm/send/SECRET-VALUE-123';
    logger.info({ pushUrl: secret }, 'a');
    logger.info({ target: { pushUrl: secret } }, 'b');
    logger.info({ message: { target: { pushUrl: secret } } }, 'c');
    expect(raw).toHaveLength(3);
    for (const line of raw) {
      expect(line).not.toContain('SECRET-VALUE-123');
      expect(line).toContain('[REDACTED]');
    }
  });
});
