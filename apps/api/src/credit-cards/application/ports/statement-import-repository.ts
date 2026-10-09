import type { AccessScope } from '../../../shared/access';

/**
 * The fingerprints of the statement lines already imported on a card (spec: idempotent import).
 * Every method filters by the scope in the same statement.
 */
export interface StatementImportRepository {
  /**
   * Claims the fingerprint for the card: `true` when it was free, `false` when an earlier import
   * already holds it (or the card is not the caller's). Atomic, so two concurrent imports of the
   * same file cannot both create a line.
   */
  claim(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<boolean>;
  /** Gives a claim back, when creating the line failed after claiming it. */
  release(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<void>;
}
