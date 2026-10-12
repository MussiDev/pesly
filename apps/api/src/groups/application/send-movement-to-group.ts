import {
  AppError,
  groupExpenseDescriptionSchema,
  GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH,
  type SendMovementToGroupRequest,
} from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import {
  GroupExpenseCategoryInvalid,
  GroupMovementAlreadySent,
  GroupMovementNotExpense,
  GroupSplitMemberInvalid,
} from '../domain/group-expense';
import { allocateShares, splitMemberIds } from './allocate-expense-shares';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupExpenseRepository, SavedExpense } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';
import type { PayerMovementRecorder } from './ports/payer-movement-recorder';

export interface SendMovementToGroupDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  payerMovements: PayerMovementRecorder;
  clock: Clock;
}

/** The movement note as a description: whitespace collapsed, cut to the limit by code points. */
function deriveDescription(note: string | null): string {
  const collapsed = (note ?? '').replace(/\s+/g, ' ').trim();
  const cut = Array.from(collapsed).slice(0, GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH).join('').trim();
  const parsed = groupExpenseDescriptionSchema.safeParse(cut);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'The description is invalid', ['body.description']);
  }
  return parsed.data;
}

export class SendMovementToGroup {
  private readonly access: GroupAccess;

  constructor(private readonly deps: SendMovementToGroupDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * Any member (spec 05i D1, D10). Reads the caller's movement, refuses what cannot be sent,
   * allocates the shares over the movement's own amount and hands the repository one write that
   * adopts the movement; the repository takes the locks and resolves the automatic category.
   */
  async execute(
    userId: string,
    groupId: string,
    data: SendMovementToGroupRequest,
  ): Promise<SavedExpense> {
    const caller = await this.access.member(userId, groupId);
    const movement = await this.deps.payerMovements.peekAdoptable(userId, data.movementId);
    if (movement === null) throw new ResourceNotFound();
    if (movement.type !== 'expense') throw new GroupMovementNotExpense();
    if (movement.linked) throw new GroupMovementAlreadySent();

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new GroupSplitMemberInvalid();
    const memberIds = new Set(detail.members.map((member) => member.id));
    if (splitMemberIds(data.split).some((id) => !memberIds.has(id))) {
      throw new GroupSplitMemberInvalid();
    }

    if (data.categoryId !== undefined) {
      const categories = await this.deps.groups.listCategories(groupId);
      const category = categories.find((candidate) => candidate.id === data.categoryId);
      if (category === undefined || category.archivedAt !== null) {
        throw new GroupExpenseCategoryInvalid();
      }
    }

    const description = data.description ?? deriveDescription(movement.note);
    const shares = allocateShares(movement.amount, caller.id, data.split, detail.members);

    return this.deps.expenses.saveExpense({
      groupId,
      payerMemberId: caller.id,
      createdByMemberId: caller.id,
      amount: movement.amount,
      currency: movement.currency,
      occurredAt: movement.occurredAt,
      categoryId: data.categoryId ?? null,
      description,
      splitMode: data.split.mode,
      shares,
      activity: {
        action: 'expense_created',
        memberId: caller.id,
        createdAt: this.deps.clock.now(),
        fromMovement: true,
      },
      payerMovement: null,
      adoptedMovement: {
        userId,
        movementId: movement.id,
        expectedAmount: movement.amount,
        expectedOccurredAt: movement.occurredAt,
      },
    });
  }
}
