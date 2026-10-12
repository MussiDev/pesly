import type { AccountCurrency } from '@pesly/shared';
import { and, inArray } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { AccountCurrencyReader } from '../../application/ports/account-currency-reader';
import { accounts } from './foreign-relations';

export class DrizzleAccountCurrencyReader implements AccountCurrencyReader {
  constructor(private readonly db: Database) {}

  async currenciesOf(
    scope: AccessScope,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AccountCurrency>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(and(inArray(accounts.id, [...ids]), scopedTo(scope, { owner: accounts.ownerId })));
    return new Map(rows.map((row) => [row.id, row.currency]));
  }
}
