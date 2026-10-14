import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import type {
  BalanceAdjuster,
  BalanceAdjustmentRequest,
  BalanceAdjustmentResult,
} from '../../../accounts/application/ports/balance-adjuster';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';
import { createAccountMovements } from './drizzle-account-movements';

interface LockedAccount extends Record<string, unknown> {
  type: string;
  archived: boolean;
  opening_balance: string;
}

/**
 * One transaction: the account row is locked (`for update`, by id and owner together), the balance
 * is computed AFTER the lock with the same query the balance read uses, and `target - current` is
 * inserted. Two concurrent calls on one account therefore queue on the lock and each computes its
 * difference from the balance the previous one left (threat R-03). Its answers carry a status only,
 * never an amount.
 */
class DrizzleBalanceAdjuster implements BalanceAdjuster {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date,
  ) {}

  async adjust(request: BalanceAdjustmentRequest): Promise<BalanceAdjustmentResult> {
    return this.db.transaction(async (tx): Promise<BalanceAdjustmentResult> => {
      const locked = await tx.execute<LockedAccount>(sql`
        select type, archived_at is not null as archived, opening_balance::text as opening_balance
        from accounts
        where id = ${request.accountId}::uuid and owner_id = ${request.ownerId}::uuid
        for update`);
      const account = locked.rows[0];
      if (!account) return { status: 'not_found' };
      // A card is checked first, even when archived, like the include-in-available setting.
      if (account.type === 'credit_card') return { status: 'credit_card' };
      if (account.archived) return { status: 'archived' };

      const sums = await createAccountMovements(tx).sumsByAccount([request.accountId]);
      const current = BigInt(account.opening_balance) + (sums.get(request.accountId) ?? 0n);
      const difference = request.target - current;
      if (difference === 0n) return { status: 'adjusted', balance: current, adjustment: null };
      // The table's check would refuse it (a 500); the difference is the caller's to correct.
      if (
        difference > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ||
        -difference > MOVEMENT_AMOUNT_MAX_MINOR_UNITS
      ) {
        return { status: 'out_of_range' };
      }

      const [row] = await tx
        .insert(movements)
        .values({
          ownerId: request.ownerId,
          type: 'adjustment',
          accountId: request.accountId,
          amount: difference,
          occurredAt: this.now(),
          note: request.note,
        })
        .returning({
          id: movements.id,
          accountId: movements.accountId,
          amount: movements.amount,
          occurredAt: movements.occurredAt,
          note: movements.note,
          createdAt: movements.createdAt,
        });
      if (!row) throw new Error('The adjustment insert returned no row');
      return { status: 'adjusted', balance: request.target, adjustment: row };
    });
  }
}

export function createBalanceAdjuster(
  db: Database,
  now: () => Date = () => new Date(),
): BalanceAdjuster {
  return new DrizzleBalanceAdjuster(db, now);
}
