import { OwnerOrGroupMemberAccessPolicy } from '../shared/access';
import { DenyAllGroupMembershipReader } from '../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../shared/db/client';
import type { Logger } from '../shared/logging/logger';
import type { AutomaticDebitRecorder } from './application/ports/automatic-debit-recorder';
import type { CardPayments } from './application/ports/card-payments';
import type { CardPurchases } from './application/ports/card-purchases';
import type { Clock } from './application/ports/clock';
import { CreateStatementReminders } from './application/create-statement-reminders';
import type { StatementReminderPublisher } from './application/ports/statement-reminder-publisher';
import { RecordAutomaticDebits } from './application/record-automatic-debits';
import { DrizzleAutomaticDebitLog } from './infrastructure/db/drizzle-automatic-debit-log';
import { DrizzleAutomaticDebitSource } from './infrastructure/db/drizzle-automatic-debit-source';
import { DrizzleCreditCardRepository } from './infrastructure/db/drizzle-credit-card-repository';
import { DrizzleInstallmentRepository } from './infrastructure/db/drizzle-installment-repository';
import {
  AutomaticDebitJob,
  AutomaticDebitLog as AutomaticDebitLogSink,
} from './infrastructure/jobs/automatic-debit-job';
import { DrizzleStatementReminderSource } from './infrastructure/db/drizzle-statement-reminder-source';
import {
  StatementReminderJob,
  StatementReminderLog,
} from './infrastructure/jobs/statement-reminder-job';
import { SystemClock } from './infrastructure/system-clock';

/*
 * The worker side of the module. Deliberately not re-exported from `./index`: the API process
 * imports that barrel, and the cross-owner source and the job must not be reachable from a
 * user request. The movements adapters are injected so this module never imports `movements`.
 */
export type { AutomaticDebitJob } from './infrastructure/jobs/automatic-debit-job';
export type { StatementReminderJob } from './infrastructure/jobs/statement-reminder-job';

/** Identifies the system job in the synthetic auth context; no audit line or limiter key keeps it. */
const JOB_SESSION_ID = 'automatic-debit-job';
const REMINDER_JOB_SESSION_ID = 'statement-reminder-job';

export interface AutomaticDebitJobFactoryDependencies {
  db: Database;
  logger: Logger;
  /** Records the transfers through the movements rules; the worker builds it. */
  recorder: AutomaticDebitRecorder;
  /** What each card received, to work out the unpaid remainder; the movements module provides it. */
  cardPayments: CardPayments;
  /** Daily purchase sums behind the statement totals; the movements module provides it. */
  purchases: CardPurchases;
  clock?: Clock;
  intervalSeconds: number;
}

/** The automatic debit job over the PostgreSQL repositories. */
export function createAutomaticDebitJob({
  db,
  logger,
  recorder,
  cardPayments,
  purchases,
  clock = new SystemClock(),
  intervalSeconds,
}: AutomaticDebitJobFactoryDependencies): AutomaticDebitJob {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const sink = new AutomaticDebitLogSink(logger);
  const recordDebits = new RecordAutomaticDebits({
    cards: new DrizzleCreditCardRepository(db),
    installments: new DrizzleInstallmentRepository(db),
    purchases,
    cardPayments,
    clock,
    source: new DrizzleAutomaticDebitSource(db),
    log: new DrizzleAutomaticDebitLog(db),
    recorder,
    // The only constructor of a write scope: `ownerId` comes from the source's `users` join.
    scopeFor: (ownerId) =>
      policy.scopeFor({ userId: ownerId, sessionId: JOB_SESSION_ID, emailVerified: true }, 'write'),
    report: sink.report,
    info: sink.info,
  });
  return new AutomaticDebitJob({
    execute: () => recordDebits.execute(),
    logger,
    intervalMs: intervalSeconds * 1000,
  });
}

export interface StatementReminderJobFactoryDependencies {
  db: Database;
  logger: Logger;
  /** Stores the notices; the notices module provides it and the worker injects it. */
  publisher: StatementReminderPublisher;
  /** What each card received, to work out what a statement still owes; the movements module provides it. */
  cardPayments: CardPayments;
  /** Daily purchase sums behind the statement totals; the movements module provides it. */
  purchases: CardPurchases;
  clock?: Clock;
  intervalSeconds: number;
}

/** The statement due-date reminder job over the PostgreSQL repositories. */
export function createStatementReminderJob({
  db,
  logger,
  publisher,
  cardPayments,
  purchases,
  clock = new SystemClock(),
  intervalSeconds,
}: StatementReminderJobFactoryDependencies): StatementReminderJob {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const sink = new StatementReminderLog(logger);
  const createReminders = new CreateStatementReminders({
    cards: new DrizzleCreditCardRepository(db),
    installments: new DrizzleInstallmentRepository(db),
    purchases,
    cardPayments,
    clock,
    source: new DrizzleStatementReminderSource(db),
    publisher,
    // The only constructor of a write scope: `ownerId` comes from the source's `users` join.
    scopeFor: (ownerId) =>
      policy.scopeFor(
        { userId: ownerId, sessionId: REMINDER_JOB_SESSION_ID, emailVerified: true },
        'write',
      ),
    report: sink.report,
  });
  return new StatementReminderJob({
    execute: () => createReminders.execute(),
    logger,
    intervalMs: intervalSeconds * 1000,
  });
}
