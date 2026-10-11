import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReminderSummary } from '../../src/credit-cards/application/create-statement-reminders';
import { StatementReminderJob } from '../../src/credit-cards/infrastructure/jobs/statement-reminder-job';
import { createStatementReminderJob } from '../../src/credit-cards/jobs';
import { createCardPayments, createCardPurchases } from '../../src/movements';
import { createStatementReminderPublisher } from '../../src/notices';
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
  obj: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (chunk: string) => {
        lines.push({ obj: JSON.parse(chunk) as Record<string, unknown> });
      },
    },
  });
  return { logger, lines };
}

const emptySummary: ReminderSummary = {
  cards: 0,
  reminders: 0,
  notOwed: 0,
  alreadyPublished: 0,
  failed: 0,
};

describe('statement reminder job in the worker', () => {
  it('starts, runs a pass and stops twice without error (factory output over the real adapters)', async () => {
    const { logger } = captureLogger();
    const job = createStatementReminderJob({
      db: connection.db,
      logger,
      publisher: createStatementReminderPublisher(connection.db),
      cardPayments: createCardPayments(connection.db),
      purchases: createCardPurchases(connection.db),
      intervalSeconds: 60,
    });

    expect(job.intervalMs).toBe(60_000);
    await job.runOnce();

    job.start();
    await expect(job.stop()).resolves.toBeUndefined();
    await expect(job.stop()).resolves.toBeUndefined();
  });

  it('sad path: a pass that throws is logged and the next pass still runs', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const execute = vi
      .fn<() => Promise<ReminderSummary>>()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValue(emptySummary);
    const job = new StatementReminderJob({ execute, logger, intervalMs: 1000 });

    job.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.some((l) => l.obj.msg === 'statement reminders pass errored')).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(2);
    await job.stop();
  });

  it('sad path: stop() waits for the pass in progress before it resolves', async () => {
    const { logger } = captureLogger();
    let release: (summary: ReminderSummary) => void = () => undefined;
    const execute = vi.fn(
      () =>
        new Promise<ReminderSummary>((resolve) => {
          release = resolve;
        }),
    );
    const job = new StatementReminderJob({ execute, logger, intervalMs: 60_000 });

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

describe('worker wiring of the statement reminder job', () => {
  const worker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8');

  it('imports the job from credit-cards/jobs and the publisher from notices', () => {
    expect(worker).toMatch(/from '\.\/credit-cards\/jobs'/);
    expect(worker).toContain('createStatementReminderJob');
    expect(worker).toMatch(/createStatementReminderPublisher[^;]*from '\.\/notices'/s);
  });

  it('starts the job after the automatic debit job and logs its start line', () => {
    expect(worker.indexOf('statementReminderJob.start();')).toBeGreaterThan(
      worker.indexOf('automaticDebitJob.start();'),
    );
    expect(worker).toContain("'statement reminder job started'");
    expect(worker).toContain("'email worker started'");
  });

  it('stops the job in the shutdown Promise.all, before the pool closes', () => {
    expect(worker).toMatch(/Promise\.all\(\[[^\]]*statementReminderJob\.stop\(\)[^\]]*\]\)/);
    expect(worker.indexOf('statementReminderJob.stop()')).toBeLessThan(
      worker.indexOf('pool.end()'),
    );
  });

  it('sad path: the API entry server.ts never imports credit-cards/jobs', () => {
    expect(server).not.toMatch(/credit-cards\/jobs/);
  });
});
