import type { CreateGroupExpenseRequest } from '@pesly/shared';
import {
  ExpenseAmountNotPositive,
  ExpenseDateTooFarAhead,
  GroupExpenseCategoryInvalid,
  GroupPayerAccountInvalid,
  GroupSplitMemberInvalid,
  isTooFarAhead,
  type GroupExpense,
} from '../domain/group-expense';
import { allocateShares, splitMemberIds } from './allocate-expense-shares';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupExpenseRepository } from './ports/group-expense-repository';
import type { GroupRepository } from './ports/group-repository';
import type { PayerMovementRecorder, PayerMovementToRecord } from './ports/payer-movement-recorder';

export interface RecordGroupExpenseDependencies {
  groups: GroupRepository;
  expenses: GroupExpenseRepository;
  payerMovements: PayerMovementRecorder;
  clock: Clock;
}

export class RecordGroupExpense {
  private readonly access: GroupAccess;

  constructor(private readonly deps: RecordGroupExpenseDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * Any member. Checks what needs state (membership of the payer and of every split member, the
   * category, the payer account), allocates the shares so they add up to the amount, and hands the
   * repository one write that includes the log row and, when the caller pays, the movement.
   */
  async execute(
    userId: string,
    groupId: string,
    data: CreateGroupExpenseRequest,
  ): Promise<GroupExpense> {
    const caller = await this.access.member(userId, groupId);
    const amount = BigInt(data.amount);
    if (amount <= 0n) throw new ExpenseAmountNotPositive();
    const occurredAt = new Date(data.occurredAt);
    const now = this.deps.clock.now();
    if (isTooFarAhead(occurredAt, now)) throw new ExpenseDateTooFarAhead();

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new GroupSplitMemberInvalid();
    const memberIds = new Set(detail.members.map((member) => member.id));
    if (
      !memberIds.has(data.payerMemberId) ||
      splitMemberIds(data.split).some((id) => !memberIds.has(id))
    ) {
      throw new GroupSplitMemberInvalid();
    }

    const categories = await this.deps.groups.listCategories(groupId);
    const category = categories.find((candidate) => candidate.id === data.categoryId);
    if (category === undefined || category.archivedAt !== null) {
      throw new GroupExpenseCategoryInvalid();
    }

    const shares = allocateShares(amount, data.payerMemberId, data.split, detail.members);

    const payerMovement = await this.payerMovement(
      userId,
      caller.id === data.payerMemberId,
      data,
      amount,
      occurredAt,
      detail.group.defaultRateType,
    );

    return this.deps.expenses.saveExpense({
      groupId,
      payerMemberId: data.payerMemberId,
      createdByMemberId: caller.id,
      amount,
      currency: data.currency,
      occurredAt,
      categoryId: data.categoryId,
      description: data.description,
      splitMode: data.split.mode,
      shares,
      activity: { action: 'expense_created', memberId: caller.id, createdAt: now },
      payerMovement,
    });
  }

  /** The account rules of spec D5: required when the caller pays, forbidden otherwise. */
  private async payerMovement(
    userId: string,
    callerPays: boolean,
    data: CreateGroupExpenseRequest,
    amount: bigint,
    occurredAt: Date,
    rateType: PayerMovementToRecord['rateType'],
  ): Promise<PayerMovementToRecord | null> {
    if (!callerPays) {
      if (data.payerAccount !== undefined) throw new GroupPayerAccountInvalid();
      return null;
    }
    if (data.payerAccount === undefined) throw new GroupPayerAccountInvalid();
    const { accountId, categoryId } = data.payerAccount;
    const usable = await this.deps.payerMovements.isUsable({
      userId,
      accountId,
      categoryId,
      currency: data.currency,
    });
    if (!usable) throw new GroupPayerAccountInvalid();
    return { userId, accountId, categoryId, amount, occurredAt, note: data.description, rateType };
  }
}
