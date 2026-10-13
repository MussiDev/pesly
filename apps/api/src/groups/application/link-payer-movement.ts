import type { LinkPayerMovementRequest } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import type { GroupExpense } from '../domain/group-expense';
import {
  GroupExpenseAlreadyLinked,
  GroupMovementAlreadySent,
  GroupMovementMismatch,
  GroupMovementNotExpense,
  GroupPayerAccountInvalid,
  GroupPayerOnly,
} from '../domain/group-expense';
import { GroupAccess } from './group-access';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';
import type { PayerMovementRecorder } from './ports/payer-movement-recorder';

export interface LinkPayerMovementDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  payerMovements: PayerMovementRecorder;
}

/**
 * The payer of an expense that has no movement of theirs links it afterwards (FEAT-008): `create`
 * records the movement from an account and a personal category, `adopt` takes one the payer already
 * registered. Only the payer, a registered member, can; nothing else of the expense changes.
 */
export class LinkPayerMovement {
  private readonly access: GroupAccess;

  constructor(private readonly deps: LinkPayerMovementDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  async execute(
    userId: string,
    groupId: string,
    expenseId: string,
    body: LinkPayerMovementRequest,
  ): Promise<GroupExpense> {
    const expense = await payerOfUnlinked(this.deps, this.access, userId, groupId, expenseId);
    const { payerMovements, expenses, groups } = this.deps;

    if (body.mode === 'create') {
      const usable = await payerMovements.isUsable({
        userId,
        accountId: body.accountId,
        categoryId: body.categoryId,
        currency: expense.currency,
      });
      if (!usable) throw new GroupPayerAccountInvalid();
      const detail = await groups.getGroup(groupId);
      if (detail === null) throw new ResourceNotFound();
      return expenses.linkPayerMovement({
        groupId,
        expenseId,
        payerUserId: userId,
        link: {
          mode: 'create',
          movement: {
            userId,
            accountId: body.accountId,
            categoryId: body.categoryId,
            amount: expense.amount,
            occurredAt: expense.occurredAt,
            note: expense.description,
            rateType: detail.group.defaultRateType,
          },
        },
      });
    }

    const movement = await payerMovements.peekAdoptable(userId, body.movementId);
    if (movement === null) throw new ResourceNotFound();
    if (movement.type !== 'expense') throw new GroupMovementNotExpense();
    if (movement.linked) throw new GroupMovementAlreadySent();
    if (movement.amount !== expense.amount || movement.currency !== expense.currency) {
      throw new GroupMovementMismatch();
    }
    return expenses.linkPayerMovement({
      groupId,
      expenseId,
      payerUserId: userId,
      link: {
        mode: 'adopt',
        movementId: movement.id,
        expectedAmount: movement.amount,
        expectedOccurredAt: movement.occurredAt,
      },
    });
  }
}

/**
 * The checks the link and the candidates share, in this order: membership (a missing group and a
 * non-member are the same 404), the expense (404), the payer (403, a ghost payer included), and no
 * movement yet (409).
 */
export async function payerOfUnlinked(
  deps: { expenses: GroupExpenseRepository },
  access: GroupAccess,
  userId: string,
  groupId: string,
  expenseId: string,
): Promise<GroupExpense> {
  const caller = await access.member(userId, groupId);
  const expense = await deps.expenses.getExpense(groupId, expenseId);
  if (expense === null) throw new ResourceNotFound();
  if (expense.payerMemberId !== caller.id) throw new GroupPayerOnly();
  if (expense.payerMovementId !== null) throw new GroupExpenseAlreadyLinked();
  return expense;
}
