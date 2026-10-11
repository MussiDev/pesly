import { dateInTimeZone, todayInTimeZone } from '@pesly/shared';
import { CreateMovement } from '../../../movements/application/create-movement';
import { localDayRange } from '../../../movements/application/local-day-range';
import type { UserPreferences } from '../../../movements/application/ports/user-preferences';
import { DrizzleAccountLookup } from '../../../movements/infrastructure/db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../../../movements/infrastructure/db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../../../movements/infrastructure/db/drizzle-movement-repository';
import { DrizzleRateLookup } from '../../../movements/infrastructure/db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../../../movements/infrastructure/db/drizzle-user-preferences';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type { Clock } from '../../application/ports/clock';
import type {
  PayerAccountCheck,
  PayerMovementRecorder,
  PayerMovementToRecord,
} from '../../application/ports/payer-movement-recorder';
import { SystemClock } from '../clock/system-clock';

/** The transaction handle drizzle passes to the callback of `Database.transaction`. */
export type PayerTx = Parameters<Parameters<Database['transaction']>[0]>[0];

const ONE_MS = 1;

// The movement belongs to the payer alone, so it is written with a plain owner scope: no group
// read access is involved and the deny-all reader keeps it that way.
const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 'group-expense', emailVerified: true }, 'write');
}

/**
 * Records the payer's movement on the repository's open transaction (spec D6), through the same
 * rules `POST /movements` applies (account and category of the caller, kind, rate, date).
 */
export class DrizzlePayerMovementRecorder implements PayerMovementRecorder<PayerTx> {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async isUsable(check: PayerAccountCheck): Promise<boolean> {
    const scope = await writeScope(check.userId);
    const account = await new DrizzleAccountLookup(this.db).find(scope, check.accountId);
    if (account === null || account.archived || account.currency !== check.currency) return false;
    const category = await new DrizzleCategoryLookup(this.db).find(scope, check.categoryId);
    return category !== null && category.kind === 'expense' && !category.archived;
  }

  async record(unit: PayerTx, movement: PayerMovementToRecord): Promise<{ id: string }> {
    // A transaction handle has the query API of the connection; nested transaction() is a savepoint.
    const db: Database = unit;
    const baseline = new DrizzleUserPreferences(db);
    const { timeZone } = await baseline.find(movement.userId);
    // The rate follows the group's rate type, not the payer's own default.
    const preferences: UserPreferences = {
      find: async (userId) => ({
        ...(await baseline.find(userId)),
        defaultRateType: movement.rateType,
      }),
    };
    const create = new CreateMovement({
      movements: new DrizzleMovementRepository(db),
      accounts: new DrizzleAccountLookup(db),
      categories: new DrizzleCategoryLookup(db),
      rates: new DrizzleRateLookup(db),
      preferences,
      clock: this.clock,
    });
    const scope = await writeScope(movement.userId);
    const created = await create.execute(scope, {
      type: 'expense',
      accountId: movement.accountId,
      categoryId: movement.categoryId,
      amount: movement.amount,
      occurredAt: this.latestAllowed(movement.occurredAt, timeZone),
      note: movement.note,
      rate: { source: 'automatic' },
    });
    return { id: created.id };
  }

  // TODO(DISC-001-05d Block 4): not implemented yet, Block 3 only extends the port.
  update(): Promise<void> {
    return Promise.reject(new Error('not implemented: Block 4'));
  }

  // TODO(DISC-001-05d Block 4): not implemented yet, Block 3 only extends the port.
  remove(): Promise<void> {
    return Promise.reject(new Error('not implemented: Block 4'));
  }

  /**
   * Movements reject a date after today in the user's time zone, while an expense may be dated 1
   * day ahead (spec D13), so a later date is clamped to the last instant of today.
   */
  private latestAllowed(occurredAt: Date, timeZone: string): Date {
    const today = todayInTimeZone(this.clock.now(), timeZone);
    if (dateInTimeZone(occurredAt, timeZone) <= today) return occurredAt;
    const { occurredBefore } = localDayRange(undefined, today, timeZone);
    if (occurredBefore === undefined) throw new RangeError('today has no end');
    return new Date(occurredBefore.getTime() - ONE_MS);
  }
}
