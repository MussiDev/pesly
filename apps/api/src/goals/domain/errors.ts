import { AppError } from '@pesly/shared';

/** The goal and the account it links to have different currencies (AC-03). */
export class GoalAccountCurrencyMismatch extends AppError {
  constructor() {
    super('GOAL_ACCOUNT_CURRENCY_MISMATCH');
  }
}

/** The account to link is archived; same code the accounts module answers. */
export class GoalAccountArchived extends AppError {
  constructor() {
    super('ACCOUNT_ARCHIVED');
  }
}

/** A goal linked to an account has no manual entries (AC-19). */
export class GoalLinkedToAccount extends AppError {
  constructor() {
    super('GOAL_LINKED_TO_ACCOUNT');
  }
}

/** The withdrawal is larger than the goal's progress (AC-07). */
export class GoalWithdrawalExceedsProgress extends AppError {
  constructor() {
    super('GOAL_WITHDRAWAL_EXCEEDS_PROGRESS');
  }
}

/** The contribution would push progress above the largest request amount. */
export class GoalProgressTooLarge extends AppError {
  constructor() {
    super('GOAL_PROGRESS_TOO_LARGE');
  }
}

/** The user already holds the maximum number of goals (AC-24). */
export class GoalLimitReached extends AppError {
  constructor() {
    super('GOAL_LIMIT_REACHED');
  }
}

/** State-free input check the use cases repeat in front of the repository; names the field only. */
export class InvalidGoalInput extends AppError {
  constructor(field: string) {
    super('VALIDATION_FAILED', 'invalid goal input', [field]);
  }
}
