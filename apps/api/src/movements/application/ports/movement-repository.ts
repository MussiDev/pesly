import type { AccessScope } from '../../../shared/access';
import type { Movement, MovementFilters, NewMovement } from '../../domain/movement';

export type { MovementFilters, NewMovement };

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null`). Lists are ordered newest first (`occurredAt`, then `id`, both descending).
 */
export interface MovementRepository {
  /** The owner is the scope's user; stores `data.tags` with the movement or not at all. */
  insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement>;
  list(
    scope: AccessScope<'read'>,
    options: { limit: number; offset: number; filters: MovementFilters },
  ): Promise<{ items: Movement[]; total: number }>;
  /** Any action's scope: the write path reads the current row before it replaces it. */
  findById(scope: AccessScope, id: string): Promise<Movement | null>;
  /**
   * Replaces the movement of that id and type in the scope with `data` (the full editable state;
   * `id`, owner and `createdAt` never change) and re-links its tags. `null` when none matches.
   */
  update(scope: AccessScope<'write'>, id: string, data: NewMovement): Promise<Movement | null>;
  /** Removes the movement and its tag links; `false` when none matches in the scope. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}
