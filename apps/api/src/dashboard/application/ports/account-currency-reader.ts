import type { AccountCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface AccountCurrencyReader {
  /**
   * The currency of each of the caller's own accounts among `ids`, in one statement. An id that is
   * not the caller's is absent from the map.
   */
  currenciesOf(
    scope: AccessScope,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AccountCurrency>>;
}
