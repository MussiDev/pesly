import { OwnerOrGroupMemberAccessPolicy } from '../shared/access';
import { DenyAllGroupMembershipReader } from '../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../shared/db/client';
import type { Logger } from '../shared/logging/logger';
import type { Clock } from './application/ports/clock';
import type { ExpenseRecorder } from './application/ports/expense-recorder';
import { RecordDueOccurrences } from './application/record-due-occurrences';
import { DrizzleAutomaticPaymentSource } from './infrastructure/db/drizzle-automatic-payment-source';
import { DrizzleOccurrenceRepository } from './infrastructure/db/drizzle-occurrence-repository';
import { RecordingJob, RecordingLog } from './infrastructure/jobs/recording-job';
import { SystemClock } from './infrastructure/system-clock';

/*
 * The worker side of the module. Deliberately not re-exported from `./index`: the API process
 * imports that barrel, and the cross-owner source and the job must not be reachable from a
 * user request. The recorder is injected so this module never imports `movements`.
 */
export type { RecordingJob } from './infrastructure/jobs/recording-job';

/** Identifies the system job in the synthetic auth context; no audit line or limiter key keeps it. */
const JOB_SESSION_ID = 'recurring-recording-job';

export interface RecurringJobFactoryDependencies {
  db: Database;
  logger: Logger;
  /** Records the expenses through the movements rules; the worker builds it. */
  recorder: ExpenseRecorder;
  clock?: Clock;
  intervalSeconds: number;
}

/** The recording job over the PostgreSQL repositories. */
export function createRecordingJob({
  db,
  logger,
  recorder,
  clock = new SystemClock(),
  intervalSeconds,
}: RecurringJobFactoryDependencies): RecordingJob {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const log = new RecordingLog(logger);
  const recordDue = new RecordDueOccurrences({
    source: new DrizzleAutomaticPaymentSource(db),
    occurrences: new DrizzleOccurrenceRepository(db),
    expenses: recorder,
    clock,
    // The only constructor of a write scope: `ownerId` comes from the source's `users` join.
    scopeFor: (ownerId) =>
      policy.scopeFor({ userId: ownerId, sessionId: JOB_SESSION_ID, emailVerified: true }, 'write'),
    report: log.report,
    info: log.info,
  });
  return new RecordingJob({
    execute: () => recordDue.execute(),
    logger,
    intervalMs: intervalSeconds * 1000,
  });
}

export interface RecurringJobs {
  start(): void;
  /** Stops the job and waits for the pass in progress; stopping twice is harmless. */
  stop(): Promise<void>;
}

export function createRecurringJobs(dependencies: RecurringJobFactoryDependencies): RecurringJobs {
  const job = createRecordingJob(dependencies);
  return {
    start() {
      job.start();
    },
    stop: () => job.stop(),
  };
}
