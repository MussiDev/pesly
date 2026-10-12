import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushMessage } from '../../src/push/application/ports/push-provider';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';

const msg = (pushUrl: string, topic = 'a'): PushMessage => ({
  target: { pushUrl, p256dh: 'k', auth: 'a' },
  body: new Uint8Array([1]),
  ttlSeconds: 21600,
  topic,
  urgency: 'normal',
});

afterEach(() => vi.restoreAllMocks());

describe('FakePushProvider', () => {
  it('records messages in order, opens no connection and scripts one device', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fake = new FakePushProvider();
    fake.script('https://fcm.googleapis.com/one', [{ kind: 'gone' }]);
    const first = await fake.send(msg('https://fcm.googleapis.com/one', 'x'));
    const second = await fake.send(msg('https://fcm.googleapis.com/two', 'y'));
    const third = await fake.send(msg('https://fcm.googleapis.com/one', 'z'));
    expect(first).toEqual({ kind: 'gone' });
    expect(second).toEqual({ kind: 'accepted' });
    expect(third).toEqual({ kind: 'accepted' });
    expect(fake.sent.map((m) => m.topic)).toEqual(['x', 'y', 'z']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('consumes scripted outcomes in order and honours the delay', async () => {
    vi.useFakeTimers();
    const fake = new FakePushProvider();
    fake.delayMs = 500;
    fake.script('https://fcm.googleapis.com/one', [
      { kind: 'retry', status: 503, retryAfterSeconds: null },
      { kind: 'rejected', status: 400 },
    ]);
    const pending = fake.send(msg('https://fcm.googleapis.com/one'));
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: 'retry', status: 503, retryAfterSeconds: null });
    fake.delayMs = 0;
    expect(await fake.send(msg('https://fcm.googleapis.com/one'))).toEqual({
      kind: 'rejected',
      status: 400,
    });
    vi.useRealTimers();
  });
});
