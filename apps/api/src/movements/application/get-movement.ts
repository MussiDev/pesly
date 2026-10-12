import type { MovementGroupLink } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import type { MovementRepository } from './ports/movement-repository';

export interface GetMovementDependencies {
  movements: MovementRepository;
}

export class GetMovement {
  constructor(private readonly deps: GetMovementDependencies) {}

  /** The movement and the group expense it is linked to, if any. */
  async execute(
    scope: AccessScope<'read'>,
    id: string,
  ): Promise<{ movement: Movement; groupExpense: MovementGroupLink | null }> {
    const movement = notFoundUnlessAllowed(await this.deps.movements.findById(scope, id));
    const links = await this.deps.movements.groupLinks(scope, [movement.id]);
    return { movement, groupExpense: links[movement.id] ?? null };
  }
}
