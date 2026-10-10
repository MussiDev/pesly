import { GROUP_EXPENSES_PAGE_SIZE_DEFAULT } from '@pesly/shared';
import type {
  GroupExpenseRepository,
  PersonalSharesPageResult,
} from './ports/group-expense-repository';

export interface ListPersonalSharesDependencies {
  expenses: GroupExpenseRepository;
}

export interface PersonalSharesInput {
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export class ListPersonalShares {
  constructor(private readonly deps: ListPersonalSharesDependencies) {}

  /**
   * The caller's own shares and receivables across groups (spec D7). It needs no group guard: the
   * repository only looks at the member rows of `userId`, so there is nothing of others to leak.
   */
  async execute(userId: string, input: PersonalSharesInput): Promise<PersonalSharesPageResult> {
    return this.deps.expenses.listPersonalShares(userId, {
      limit: input.limit ?? GROUP_EXPENSES_PAGE_SIZE_DEFAULT,
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    });
  }
}
