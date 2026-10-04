import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { MovementTypeImmutable } from '../domain/errors';
import type { Movement } from '../domain/movement';
import {
  buildNewMovement,
  type BuildMovementDependencies,
  type EditMovementInput,
} from './build-new-movement';
import type { MovementRepository } from './ports/movement-repository';

export interface UpdateMovementDependencies extends BuildMovementDependencies {
  movements: MovementRepository;
}

/**
 * Replaces a movement of the caller with the values of an edit. The movement is read inside the
 * caller's scope first, so a foreign or missing id is a not found before anything else is said
 * about it; then the type is compared, the rules of a creation are applied, and the write is
 * conditioned on the same id, owner and type.
 */
export class UpdateMovement {
  constructor(private readonly deps: UpdateMovementDependencies) {}

  async execute(
    scope: AccessScope<'write'>,
    id: string,
    input: EditMovementInput,
  ): Promise<Movement> {
    const existing = notFoundUnlessAllowed(await this.deps.movements.findById(scope, id));
    if (existing.type !== input.type) throw new MovementTypeImmutable();

    const data = await buildNewMovement(this.deps, scope, input, existing);
    // `null`: the movement vanished between the read and the write.
    return notFoundUnlessAllowed(await this.deps.movements.update(scope, id, data));
  }
}
