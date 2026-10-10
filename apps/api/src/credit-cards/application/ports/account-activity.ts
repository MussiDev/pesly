/**
 * Whether an account has movements; the movements module implements it (spec D10).
 *
 * UNSCOPED BY DESIGN: it takes no `AccessScope`. It is safe only because the use cases pass it the
 * linked account ids of a card the scoped repository just returned.
 */
export interface AccountActivity {
  hasMovements(accountId: string): Promise<boolean>;
}
