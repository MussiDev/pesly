import { ResourceNotFound, type AccessScope } from '../../shared/access';
import type { MovementRepository } from './ports/movement-repository';

export interface DeleteMovementDependencies {
  movements: MovementRepository;
}

export class DeleteMovement {
  constructor(private readonly deps: DeleteMovementDependencies) {}

  /** A movement outside the scope is indistinguishable from a missing one: not found. */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    if (!(await this.deps.movements.delete(scope, id))) throw new ResourceNotFound();
  }
}
