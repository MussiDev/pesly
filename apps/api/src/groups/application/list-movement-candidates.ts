import { MOVEMENT_CANDIDATES_MAX } from '@pesly/shared';
import { GroupAccess } from './group-access';
import { payerOfUnlinked } from './link-payer-movement';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';
import type { MovementCandidateRow, PayerMovementRecorder } from './ports/payer-movement-recorder';

export interface ListMovementCandidatesDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  payerMovements: PayerMovementRecorder;
}

/**
 * The movements the payer of an unlinked expense could adopt: their own expense movements of the
 * expense's amount and currency that no group expense holds (FEAT-008). Same access rules as the link.
 */
export class ListMovementCandidates {
  private readonly access: GroupAccess;

  constructor(private readonly deps: ListMovementCandidatesDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  async execute(
    userId: string,
    groupId: string,
    expenseId: string,
  ): Promise<MovementCandidateRow[]> {
    const expense = await payerOfUnlinked(this.deps, this.access, userId, groupId, expenseId);
    return this.deps.payerMovements.listCandidates(userId, {
      amount: expense.amount,
      currency: expense.currency,
      limit: MOVEMENT_CANDIDATES_MAX,
    });
  }
}
