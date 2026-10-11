import type { AccessScope } from '../../../shared/access';
import type { Currency } from '../../domain/statement-payment';

export interface DebitAccountInfo {
  currency: Currency;
  archived: boolean;
}

/** Reads the owner's accounts to validate a debit link. */
export interface DebitAccounts {
  /** The account's currency and archive state, or `null` when it is missing or not the caller's. */
  find(scope: AccessScope, accountId: string): Promise<DebitAccountInfo | null>;
}
