import { AppError } from '@pesly/shared';

/** The user already holds the maximum number of budgets (50). */
export class BudgetLimitReached extends AppError {
  constructor() {
    super('BUDGET_LIMIT_REACHED');
  }
}

/** A budget can only cover expense categories. */
export class BudgetCategoryKindInvalid extends AppError {
  constructor() {
    super('BUDGET_CATEGORY_KIND_INVALID');
  }
}
