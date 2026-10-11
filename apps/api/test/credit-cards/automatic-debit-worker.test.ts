import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DebitSummary } from '../../src/credit-cards/application/record-automatic-debits';
import { AutomaticDebitJob } from '../../src/credit-cards/infrastructure/jobs/automatic-debit-job';
import { createAutomaticDebitJob } from '../../src/credit-cards/jobs';
import {
  createAutomaticDebitRecorder,
  createCardPayments,
  createCardPurchases,
} from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger, type Logger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Line {
  level: number;
  obj: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (chunk: string) => {
        const obj = JSON.parse(chunk) as Record<string, unknown>;
        lines.push({ level: Number(obj.level), obj });
      },
    },
  });
  return { logger, lines };
}

const emptySummary: DebitSummary = {
  cards: 0,
  recorded: 0,
  skippedCovered: 0,
  skippedUnavailable: 0,
  skippedRefused: 0,
  alreadySettled: 0,
  failed: 0,
};

describe('automatic debit job in the worker', () => {
  it('starts, runs a pass and stops twice without error (factory output over the real adapters)', async () => {
    const { logger } = captureLogger();
    const job = createAutomaticDebitJob({
      db: connection.db,
      logger,
      recorder: createAutomaticDebitRecorder(connection.db, logger),
      cardPayments: createCardPayments(connection.db),
      purchases: createCardPurchases(connection.db),
      intervalSeconds: 60,
    });

    const summary = await job.runOnce();
    expect(summary.failed).toBe(0);

    job.start();
    await expect(job.stop()).resolves.toBeUndefined();
    await expect(job.stop()).resolves.toBeUndefined();
  });

  it('sad path: a pass that throws is logged and the next pass still runs', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const execute = vi
      .fn<() => Promise<DebitSummary>>()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValue(emptySummary);
    const job = new AutomaticDebitJob({ execute, logger, intervalMs: 1000 });

    job.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.some((l) => l.obj.msg === 'automatic debits pass errored')).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(2);
    await job.stop();
  });

  it('sad path: stop() waits for the pass in progress before it resolves', async () => {
    const { logger } = captureLogger();
    let release: (summary: DebitSummary) => void = () => undefined;
    const execute = vi.fn(
      () =>
        new Promise<DebitSummary>((resolve) => {
          release = resolve;
        }),
    );
    const job = new AutomaticDebitJob({ execute, logger, intervalMs: 60_000 });

    job.start();
    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);

    release(emptySummary);
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe('worker wiring of the automatic debit job', () => {
  const worker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8');

  it('imports the job from credit-cards/jobs and the adapters from movements', () => {
    expect(worker).toMatch(/from '\.\/credit-cards\/jobs'/);
    expect(worker).toContain('createAutomaticDebitJob');
    expect(worker).toContain('createAutomaticDebitRecorder');
    expect(worker).toContain('createCardPayments');
    expect(worker).toContain('createCardPurchases');
  });

  it('starts the job after the recurring jobs and logs its start line', () => {
    expect(worker.indexOf('automaticDebitJob.start();')).toBeGreaterThan(
      worker.indexOf('recurringJobs.start();'),
    );
    expect(worker).toContain("'automatic debit job started'");
    expect(worker).toContain("'email worker started'");
  });

  it('stops the job in the shutdown Promise.all, before the pool closes', () => {
    expect(worker).toMatch(/Promise\.all\(\[[^\]]*automaticDebitJob\.stop\(\)[^\]]*\]\)/);
    expect(worker.indexOf('automaticDebitJob.stop()')).toBeLessThan(worker.indexOf('pool.end()'));
  });

  it('sad path: the API entry server.ts never imports credit-cards/jobs', () => {
    expect(server).not.toMatch(/credit-cards\/jobs/);
  });
});
