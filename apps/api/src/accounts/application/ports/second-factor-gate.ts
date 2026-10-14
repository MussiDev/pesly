/**
 * Asks the identity module to prove the second factor before a sensitive write. Resolves when the
 * user has 2FA off (no code is asked) or the code is valid and spent; rejects with `TotpInvalid`
 * (missing, wrong or used code) or `RateLimited` (attempt limits exhausted, the code unchecked).
 */
export interface SecondFactorGate {
  require(userId: string, code: string | undefined): Promise<void>;
}
