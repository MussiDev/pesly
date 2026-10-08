import { AppError } from '@pesly/shared';
import type {
  PaymentToRecord,
  RecordedPaymentMovement,
  StatementPaymentRecorder,
} from '../../../credit-cards/application/ports/statement-payment-recorder';
import { notFoundUnlessAllowed, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { Logger } from '../../../shared/logging/logger';
import { CreateMovement } from '../../application/create-movement';
import type { Clock } from '../../application/ports/clock';
import { RecordManualMovement } from '../../application/record-manual-movement';
import { DrizzleAccountLookup } from '../db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../db/drizzle-user-preferences';
import { SystemClock } from '../system-clock';

export interface StatementPaymentRecorderOptions {
  /** Manual creations per user per minute (default 60), shared with `POST /movements`. */
  writeLimit?: number;
  /** Defaults to the system clock; tests inject one to control the limiter window. */
  clock?: Clock;
}

class MovementsStatementPaymentRecorder implements StatementPaymentRecorder {
  constructor(
    private readonly recordManualMovement: RecordManualMovement,
    private readonly accounts: DrizzleAccountLookup,
  ) {}

  async record(
    scope: AccessScope<'write'>,
    payment: PaymentToRecord,
  ): Promise<RecordedPaymentMovement> {
    const source = notFoundUnlessAllowed(await this.accounts.find(scope, payment.sourceAccountId));
    const destination = notFoundUnlessAllowed(
      await this.accounts.find(scope, payment.destinationAccountId),
    );
    const note = payment.note === undefined ? {} : { note: payment.note };
    const crossCurrency = source.currency === 'ARS' && destination.currency === 'USD';

    if (payment.pesosDebited !== undefined && !crossCurrency) {
      throw new AppError('VALIDATION_FAILED', 'Only a USD payment from an ARS account has pesos');
    }
    if (crossCurrency) {
      if (payment.pesosDebited === undefined) {
        throw new AppError('VALIDATION_FAILED', 'A USD payment from an ARS account needs pesos');
      }
      const movement = await this.recordManualMovement.execute(scope, {
        type: 'exchange',
        accountId: payment.sourceAccountId,
        destinationAccountId: payment.destinationAccountId,
        amount: payment.pesosDebited,
        destinationAmount: payment.amount,
        occurredAt: payment.occurredAt,
        ...note,
      });
      if (movement.type !== 'exchange') throw new Error('An exchange was expected');
      return {
        id: movement.id,
        occurredAt: movement.occurredAt,
        exchange: { pesosAmount: movement.amount, rate: movement.rate },
      };
    }

    const movement = await this.recordManualMovement.execute(scope, {
      type: 'transfer',
      accountId: payment.sourceAccountId,
      destinationAccountId: payment.destinationAccountId,
      amount: payment.amount,
      occurredAt: payment.occurredAt,
      ...note,
    });
    return { id: movement.id, occurredAt: movement.occurredAt, exchange: null };
  }
}

/** The same use case and manual limiter bucket `POST /movements` uses, so every transfer rule applies (spec D5, D6). */
export function createStatementPaymentRecorder(
  db: Database,
  logger: Logger,
  { writeLimit, clock = new SystemClock() }: StatementPaymentRecorderOptions = {},
): StatementPaymentRecorder {
  const createMovement = new CreateMovement({
    movements: new DrizzleMovementRepository(db),
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  return new MovementsStatementPaymentRecorder(
    new RecordManualMovement(
      {
        createMovement,
        limiter: new DrizzleMovementWriteLimiter(db, clock),
        clock,
        // A failed refund only makes the limit stricter; it is logged without any request data.
        reportReleaseFailure: (error: unknown) => {
          logger.error({ err: error }, 'movement write limiter release failed');
        },
      },
      writeLimit,
    ),
    new DrizzleAccountLookup(db),
  );
}
