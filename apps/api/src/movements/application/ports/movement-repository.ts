import type { MovementGroupLink } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Movement, MovementFilters, NewMovement } from '../../domain/movement';

export type { MovementFilters, NewMovement };

/** Options of `update`; the group lock is on unless a caller that owns the change bypasses it. */
export interface UpdateMovementOptions {
  /** Only the payer recorder applying an expense edit passes true (spec 05i D3). */
  bypassGroupLock?: boolean;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null`). Lists are ordered newest first (`occurredAt`, then `id`, both descending).
 */
export interface MovementRepository {
  /**
   * The owner is the scope's user; stores `data.tags` with the movement or not at all. With an `id`
   * the movement is stored under it, and an id that is already taken, by this owner or another,
   * throws `DuplicateMovementId` and stores nothing.
   */
  insert(scope: AccessScope<'write'>, data: NewMovement, id?: string): Promise<Movement>;
  list(
    scope: AccessScope<'read'>,
    options: { limit: number; offset: number; filters: MovementFilters },
  ): Promise<{ items: Movement[]; total: number }>;
  /** Any action's scope: the write path reads the current row before it replaces it. */
  findById(scope: AccessScope, id: string): Promise<Movement | null>;
  /**
   * Replaces the movement of that id and type in the scope with `data` (the full editable state;
   * `id`, owner and `createdAt` never change) and re-links its tags. `null` when none matches.
   * Throws `MovementLockedByGroupExpense` when a group expense adopted the movement and the change
   * touches its amount, account or date, unless `options.bypassGroupLock` is true.
   */
  update(
    scope: AccessScope<'write'>,
    id: string,
    data: NewMovement,
    options?: UpdateMovementOptions,
  ): Promise<Movement | null>;
  /**
   * The group expense each owned movement of `ids` is linked to (adopted or created in the group),
   * by movement id; movements without a link and ids outside the scope are absent.
   */
  groupLinks(
    scope: AccessScope,
    ids: readonly string[],
  ): Promise<Record<string, MovementGroupLink>>;
  /** Removes the movement and its tag links; `false` when none matches in the scope. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}
