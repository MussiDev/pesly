import { describe, expect, it } from 'vitest';
import type { ApiFailure, ApiResult } from '../src/lib/api-client';
import type { QueuedMovement } from '../src/lib/local-store/queue';
import { runSyncPass, SYNC_CONCURRENCY } from '../src/lib/sync/sync-pass';

const ACCOUNT = '00000000-0000-4000-8000-000000000900';
const CATEGORY = '00000000-0000-4000-8000-000000000901';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function queued(n: number, rejection?: string): QueuedMovement {
  return {
    id: id(n),
    createdAt: new Date(Date.UTC(2026, 9, 2, 12, 0, 0, n)).toISOString(),
    request: {
      id: id(n),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '150050',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'manual', value: '14000000' },
    },
    ...(rejection === undefined ? {} : { rejection: { code: rejection } }),
  };
}

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

const ok: ApiResult<unknown> = { ok: true, data: {} };

function failure(code: ApiFailure['code'], retryAfterSeconds?: number): ApiFailure {
  return {
    ok: false,
    code,
    messageKey: code === 'NETWORK' ? 'network' : 'unexpected',
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

/** What a pass leaves behind: the ids it reported as sent and as rejected, in call order. */
function recorder() {
  const sent: string[] = [];
  const rejected: [string, string][] = [];
  return {
    sent,
    rejected,
    onSent: (itemId: string) => {
      sent.push(itemId);
    },
    onRejected: (itemId: string, code: string) => {
      rejected.push([itemId, code]);
    },
  };
}

describe('runSyncPass', () => {
  it('sends nothing for an empty queue (AC-05)', async () => {
    const calls: unknown[] = [];

    const outcome = await runSyncPass({
      items: [],
      send: (request) => {
        calls.push(request);
        return Promise.resolve(ok);
      },
      ...recorder(),
    });

    expect(calls).toEqual([]);
    expect(outcome).toEqual({ sent: 0, rejected: 0 });
  });

  it('sends every pending movement once, oldest first, and reports them sent (AC-05)', async () => {
    const log = recorder();
    const calls: (string | undefined)[] = [];

    const outcome = await runSyncPass({
      items: range(5).map((n) => queued(n)),
      send: (request) => {
        calls.push(request.id);
        return Promise.resolve(ok);
      },
      ...log,
      concurrency: 1,
    });

    expect(calls).toEqual(range(5).map(id));
    expect(log.sent).toEqual(range(5).map(id));
    expect(outcome).toEqual({ sent: 5, rejected: 0 });
  });

  it('keeps at most 4 requests in flight with 100 movements (NFR-02)', async () => {
    expect(SYNC_CONCURRENCY).toBe(4);
    let inFlight = 0;
    let highest = 0;

    const outcome = await runSyncPass({
      items: range(100).map((n) => queued(n)),
      send: async () => {
        inFlight += 1;
        highest = Math.max(highest, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return ok;
      },
      ...recorder(),
    });

    expect(highest).toBe(4);
    expect(outcome.sent).toBe(100);
  });

  it('stops on a network failure and keeps every movement that was not sent (FR-04)', async () => {
    const log = recorder();
    let calls = 0;

    const outcome = await runSyncPass({
      items: range(6).map((n) => queued(n)),
      send: () => {
        calls += 1;
        return Promise.resolve(calls <= 2 ? ok : failure('NETWORK'));
      },
      ...log,
      concurrency: 1,
    });

    expect(outcome).toEqual({ sent: 2, rejected: 0, stopped: 'offline' });
    expect(log.sent).toEqual([id(1), id(2)]);
    expect(log.rejected).toEqual([]);
    expect(calls).toBe(3);
  });

  it.each([
    ['UNAUTHENTICATED', 'unauthenticated'],
    ['EMAIL_NOT_VERIFIED', 'not-verified'],
    ['INTERNAL', 'server-error'],
  ] as const)(
    'stops on %s and keeps the movements, with no rejection (FR-04)',
    async (code, reason) => {
      const log = recorder();

      const outcome = await runSyncPass({
        items: range(3).map((n) => queued(n)),
        send: () => Promise.resolve(failure(code)),
        ...log,
        concurrency: 1,
      });

      expect(outcome).toEqual({ sent: 0, rejected: 0, stopped: reason });
      expect(log.rejected).toEqual([]);
      expect(log.sent).toEqual([]);
    },
  );

  it('stops on a rate limit and reports the retry time of the answer (FR-04)', async () => {
    const outcome = await runSyncPass({
      items: range(3).map((n) => queued(n)),
      send: () => Promise.resolve(failure('RATE_LIMITED', 42)),
      ...recorder(),
      concurrency: 1,
    });

    expect(outcome).toEqual({
      sent: 0,
      rejected: 0,
      stopped: 'rate-limited',
      retryAfterSeconds: 42,
    });
  });

  it('flags a movement the server refuses with its error code and goes on with the rest (FR-04)', async () => {
    const log = recorder();

    const outcome = await runSyncPass({
      items: range(3).map((n) => queued(n)),
      send: (request) => Promise.resolve(request.id === id(2) ? failure('ACCOUNT_ARCHIVED') : ok),
      ...log,
      concurrency: 1,
    });

    expect(outcome).toEqual({ sent: 2, rejected: 1 });
    expect(log.rejected).toEqual([[id(2), 'ACCOUNT_ARCHIVED']]);
    expect(log.sent).toEqual([id(1), id(3)]);
  });

  it('skips the movements already flagged as rejected (FR-04)', async () => {
    const sentIds: (string | undefined)[] = [];

    const outcome = await runSyncPass({
      items: [queued(1), queued(2, 'NOT_FOUND'), queued(3)],
      send: (request) => {
        sentIds.push(request.id);
        return Promise.resolve(ok);
      },
      ...recorder(),
    });

    expect(sentIds.sort()).toEqual([id(1), id(3)]);
    expect(outcome).toEqual({ sent: 2, rejected: 0 });
  });

  it('counts a request that throws as a network failure and keeps everything (invalid input)', async () => {
    const outcome = await runSyncPass({
      items: range(3).map((n) => queued(n)),
      send: () => Promise.reject(new Error('socket hang up')),
      ...recorder(),
      concurrency: 1,
    });

    expect(outcome).toEqual({ sent: 0, rejected: 0, stopped: 'offline' });
  });

  it('does not stop when removing a sent movement from the queue fails (invalid input)', async () => {
    const log = recorder();

    const outcome = await runSyncPass({
      items: range(3).map((n) => queued(n)),
      send: () => Promise.resolve(ok),
      onSent: () => Promise.reject(new Error('the queue could not be written')),
      onRejected: log.onRejected,
      concurrency: 1,
    });

    expect(outcome).toEqual({ sent: 3, rejected: 0 });
  });
});

/** A small seeded generator, so a failing run of the randomized tests can be reproduced. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A server that stores one row per id and answers 200 to a repeat, like POST /movements with an id.
 * A request that arrives with no id is a row of its own, so a client that forgot to resend the same
 * id would show up as an extra row.
 */
class FakeServer {
  readonly rows = new Set<string>();
  private anonymous = 0;
  receive(movementId: string | undefined): void {
    this.rows.add(movementId ?? `anonymous-${(this.anonymous += 1)}`);
  }
}

type Cut = 'before' | 'after';

describe('runSyncPass against an idempotent server with the connection cut at random (NFR-03)', () => {
  const RUNS = 1000;

  it('loses no movement and creates no duplicate in 1,000 runs cut at a random point', async () => {
    const random = seeded(20261005);
    for (let run = 0; run < RUNS; run += 1) {
      const count = 1 + Math.floor(random() * 8);
      const server = new FakeServer();
      const queue = new Map(range(count).map((n) => [id(n), queued(n)]));
      // The link dies at the k-th request of the first pass; that request is lost either before the
      // server sees it or after it stored the movement but before the answer arrived.
      const cutAt = Math.floor(random() * (count + 1));
      const cut: Cut = random() < 0.5 ? 'before' : 'after';
      let calls = 0;
      let linkUp = true;

      const send = (request: { id?: string | undefined }): Promise<ApiResult<unknown>> => {
        const index = calls;
        calls += 1;
        if (!linkUp || index > cutAt) {
          linkUp = false;
          return Promise.resolve(failure('NETWORK'));
        }
        if (index === cutAt) {
          linkUp = false;
          if (cut === 'after') server.receive(request.id);
          return Promise.resolve(failure('NETWORK'));
        }
        server.receive(request.id);
        return Promise.resolve(ok);
      };
      const first = await runSyncPass({
        items: [...queue.values()],
        send,
        onSent: (itemId) => {
          queue.delete(itemId);
        },
        onRejected: () => undefined,
        concurrency: 1 + Math.floor(random() * 4),
      });
      expect(first.rejected, `run ${run}`).toBe(0);

      // The link is back: whatever is left is sent again, and may repeat what the server stored.
      linkUp = true;
      calls = -1;
      await runSyncPass({
        items: [...queue.values()],
        send: (request) => {
          server.receive(request.id);
          return Promise.resolve(ok);
        },
        onSent: (itemId) => {
          queue.delete(itemId);
        },
        onRejected: () => undefined,
      });

      expect(queue.size, `run ${run} left in the queue`).toBe(0);
      // Every movement is on the server (none lost) and only once (a resend always carried its id).
      expect([...server.rows].sort(), `run ${run}`).toEqual(range(count).map(id));
    }
  });

  it('leaves each movement once on a server that dedupes by id, with two passes started at once, in 1,000 runs', async () => {
    const random = seeded(77);
    for (let run = 0; run < RUNS; run += 1) {
      const count = 1 + Math.floor(random() * 8);
      const rows = new Set<string>();
      const queue = new Map(range(count).map((n) => [id(n), queued(n)]));
      // A few microtask turns per request, so the two passes interleave without timers.
      const idempotentSend = async (request: {
        id?: string | undefined;
      }): Promise<ApiResult<unknown>> => {
        const turns = Math.floor(random() * 4);
        for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
        rows.add(request.id ?? 'anonymous');
        return ok;
      };
      const pass = () =>
        runSyncPass({
          items: [...queue.values()],
          send: idempotentSend,
          onSent: (itemId) => {
            queue.delete(itemId);
          },
          onRejected: () => undefined,
          concurrency: 1 + Math.floor(random() * 4),
        });

      await Promise.all([pass(), pass()]);

      expect(queue.size, `run ${run}`).toBe(0);
      expect([...rows].sort(), `run ${run}`).toEqual(range(count).map(id));
    }
  });
});
