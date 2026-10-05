import type { AccessScope } from '../../../shared/access';

/** Reads the scope's own tags only; another user's tag is never returned. */
export interface TagRepository {
  /**
   * Stored spellings of the tags whose name starts with `prefix`, compared case-insensitively
   * and treating the prefix literally, ordered alphabetically, at most `limit`.
   */
  suggest(scope: AccessScope<'read'>, prefix: string, limit: number): Promise<string[]>;
  /**
   * One page of every tag of the scope, stored spellings ordered alphabetically without regard to
   * case, and the count of all of them.
   */
  listAll(
    scope: AccessScope<'read'>,
    page: { limit: number; offset: number },
  ): Promise<{ items: string[]; total: number }>;
}
