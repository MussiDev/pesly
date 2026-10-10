import type { AccountCurrency, AccountType } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Account } from '../../domain/account';

export interface CreateAccountData {
  name: string;
  type: AccountType;
  currency: AccountCurrency;
  openingBalance: bigint;
  /** Omitted means the type default; a credit card is always stored as false. */
  includeInAvailable?: boolean;
}

export interface ActiveAccount {
  id: string;
  type: AccountType;
  currency: AccountCurrency;
  openingBalance: bigint;
  includeInAvailable: boolean;
}

/** Outcome of changing the setting, classified by the same read that decides the write. */
export type SetIncludeInAvailableResult =
  | { status: 'updated'; account: Account }
  | { status: 'not_found' }
  | { status: 'archived' }
  | { status: 'credit_card' };

export interface ListAccountsOptions {
  archived: boolean;
  limit: number;
  offset: number;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null` / `false`). Name conflicts (case-insensitive, per owner) raise `AccountNameTaken`; a
 * foreign-key violation on delete raises `AccountHasMovements`.
 */
export interface AccountRepository {
  /** The owner is the scope's user. */
  create(scope: AccessScope<'write'>, data: CreateAccountData): Promise<Account>;
  findById(scope: AccessScope, id: string): Promise<Account | null>;
  list(
    scope: AccessScope,
    options: ListAccountsOptions,
  ): Promise<{ items: Account[]; total: number }>;
  /** Every non-archived account in scope, for the per-currency totals. */
  listActive(scope: AccessScope): Promise<ActiveAccount[]>;
  rename(scope: AccessScope<'write'>, id: string, name: string): Promise<Account | null>;
  /** Only the opening balance changes; `null` when nothing in scope matched. */
  setOpeningBalance(
    scope: AccessScope<'write'>,
    id: string,
    openingBalance: bigint,
  ): Promise<Account | null>;
  /** Idempotent: setting the state an account already has returns it unchanged. */
  setArchived(scope: AccessScope<'write'>, id: string, archived: boolean): Promise<Account | null>;
  /**
   * Classifies before writing: `not_found` (nothing in scope), `credit_card` (checked first, even
   * when archived), `archived`, else `updated`. Writing the value the account already has changes
   * nothing, not even `updated_at`.
   */
  setIncludeInAvailable(
    scope: AccessScope<'write'>,
    id: string,
    value: boolean,
  ): Promise<SetIncludeInAvailableResult>;
  /** `false` when nothing in scope matched. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}
