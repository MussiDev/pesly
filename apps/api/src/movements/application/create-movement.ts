import type { AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import {
  buildNewMovement,
  type BuildMovementDependencies,
  type CreateMovementInput,
} from './build-new-movement';
import type { ExpenseSavedHook } from './ports/expense-saved-listener';
import type { MovementRepository } from './ports/movement-repository';

export type {
  CategorizedMovementInput,
  CreateMovementInput,
  ExchangeInput,
  TransferInput,
} from './build-new-movement';

export interface CreateMovementDependencies extends BuildMovementDependencies {
  movements: MovementRepository;
  /** Called after an expense is stored; absent for writers that must not evaluate it. */
  expenseSaved?: ExpenseSavedHook;
}

export class CreateMovement {
  constructor(private readonly deps: CreateMovementDependencies) {}

  /**
   * Never touches the write limiter, so a bulk import that calls it is not counted. An `id` chosen by
   * the caller (already validated as a UUID) is stored as the movement's id.
   */
  async execute(
    scope: AccessScope<'write'>,
    input: CreateMovementInput,
    id?: string,
  ): Promise<Movement> {
    const movement = await this.deps.movements.insert(
      scope,
      await buildNewMovement(this.deps, scope, input),
      id,
    );
    if (movement.type === 'expense') {
      await this.deps.expenseSaved?.run(scope, {
        categoryId: movement.categoryId,
        occurredAt: movement.occurredAt,
      });
    }
    return movement;
  }
}
