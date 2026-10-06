import { AppError } from '@pesly/shared';

/** The owner already has an account with this name (compared ignoring case). */
export class AccountNameTaken extends AppError {
  constructor() {
    super('ACCOUNT_NAME_TAKEN');
  }
}

/** The account has movements, so it can only be archived, not deleted. */
export class AccountHasMovements extends AppError {
  constructor() {
    super('ACCOUNT_HAS_MOVEMENTS');
  }
}

/** The account is one of the two linked accounts of a credit card; deleting the card removes it. */
export class AccountLinkedToCard extends AppError {
  constructor() {
    super('ACCOUNT_LINKED_TO_CARD');
  }
}

/** A credit card is never part of the available total, so its setting cannot be changed. */
export class CreditCardSettingLocked extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'credit card accounts cannot be included in the available total', [
      'body.includeInAvailable',
    ]);
  }
}

/** An archived account's setting is frozen until it is unarchived. */
export class AccountArchived extends AppError {
  constructor() {
    super('ACCOUNT_ARCHIVED');
  }
}
