import type pg from 'pg';
import type { NewRecurringPayment } from '../../src/recurring/application/ports/recurring-payment-repository';
import type { Database } from '../../src/shared/db/client';
import { newAccount, newCategory, newUserId } from '../movements/db-fixtures';

export interface RecurringOwner {
  ownerId: string;
  accountId: string;
  categoryId: string;
}

export async function newRecurringOwner(db: Database, pool: pg.Pool): Promise<RecurringOwner> {
  const ownerId = await newUserId(db);
  return {
    ownerId,
    accountId: await newAccount(pool, ownerId),
    categoryId: await newCategory(pool, ownerId, 'expense'),
  };
}

/** The "Rent" payment of the spec: monthly on day 5, asking for confirmation. */
export function rentOf(
  owner: RecurringOwner,
  overrides: Partial<NewRecurringPayment> = {},
): NewRecurringPayment {
  return {
    name: 'Rent',
    amount: 35000000n,
    accountId: owner.accountId,
    categoryId: owner.categoryId,
    frequency: 'monthly',
    weekday: null,
    dayOfMonth: 5,
    month: null,
    startDate: '2026-10-05',
    endDate: null,
    mode: 'confirmation',
    scheduleFrom: '2026-10-05',
    autoRecordingFrom: '2026-10-05',
    ...overrides,
  };
}
