import type { AccessScope } from '../../../shared/access';

export interface ExpenseSavedEvent {
  categoryId: string;
  occurredAt: Date;
}

/**
 * Called after an expense was stored (committed). Implemented by other modules (budget alerts);
 * the movements module only knows this shape.
 */
export interface ExpenseSavedListener {
  afterExpenseSaved(scope: AccessScope<'write'>, event: ExpenseSavedEvent): Promise<void>;
}

/** What `CreateMovement` and `UpdateMovement` call; it must never throw. */
export interface ExpenseSavedHook {
  run(scope: AccessScope<'write'>, event: ExpenseSavedEvent): Promise<void>;
}
