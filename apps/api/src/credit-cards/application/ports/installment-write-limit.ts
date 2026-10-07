import type { AccessScope } from '../../../shared/access';

/** A unit of the creation budget; `release` refunds it when the creation fails. */
export interface WriteUnit {
  release(): Promise<void>;
}

/**
 * The per-user creation limit shared with the movements routes (spec D7). `take` throws a
 * `RATE_LIMITED` error when the budget of the window is spent.
 */
export interface InstallmentWriteLimit {
  take(scope: AccessScope<'write'>): Promise<WriteUnit>;
}
