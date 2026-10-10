/**
 * Whether an account is linked to a credit card; the credit-cards module implements it, so the
 * accounts module never imports it (DISC-001-10a D2).
 *
 * UNSCOPED BY DESIGN: it takes no `AccessScope`. It is safe only because the accounts module passes
 * it ids the scoped `AccountRepository` just returned.
 */
export interface AccountLinks {
  isLinked(accountId: string): Promise<boolean>;
}
