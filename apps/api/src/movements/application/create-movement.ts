import type { AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import {
  buildNewMovement,
  type BuildMovementDependencies,
  type CreateMovementInput,
} from './build-new-movement';
import type { MovementRepository } from './ports/movement-repository';

export type {
  CategorizedMovementInput,
  CreateMovementInput,
  ExchangeInput,
  TransferInput,
} from './build-new-movement';

export interface CreateMovementDependencies extends BuildMovementDependencies {
  movements: MovementRepository;
}

export class CreateMovement {
  constructor(private readonly deps: CreateMovementDependencies) {}

  /** Never touches the write limiter, so a bulk import that calls it is not counted. */
  async execute(scope: AccessScope<'write'>, input: CreateMovementInput): Promise<Movement> {
    return this.deps.movements.insert(scope, await buildNewMovement(this.deps, scope, input));
  }
}
