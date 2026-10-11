import { AppError } from '@pesly/shared';

/** "<card name> ARS" or "<card name> USD" is already an account name of the owner (user decision D3). */
export class CardAccountNameTaken extends AppError {
  constructor() {
    super('ACCOUNT_NAME_TAKEN');
  }
}

/** A linked account has movements, so the card and its accounts are kept (user decision D1). */
export class CardHasMovements extends AppError {
  constructor() {
    super('CARD_HAS_MOVEMENTS');
  }
}

/** The statement's closing date has ended in the user's time zone; its dates are final (AC-07). */
export class StatementClosed extends AppError {
  constructor() {
    super('STATEMENT_CLOSED');
  }
}

/** The new dates would break the order of the card's statements (spec D9). */
export class StatementDatesInvalid extends AppError {
  constructor(field: 'body.closingDate' | 'body.dueDate', reason: string) {
    super('VALIDATION_FAILED', reason, [field]);
  }
}

/** The new default days would close an open statement on or before the previous one (spec D9). */
export class CardDaysConflict extends AppError {
  constructor() {
    super(
      'VALIDATION_FAILED',
      'the new closing day would close an open statement on or before the previous one',
      ['body.closingDay'],
    );
  }
}

/** The debit account's currency differs from the currency it is linked for (AC-02). */
export class DebitAccountCurrencyMismatch extends AppError {
  constructor() {
    super('DEBIT_ACCOUNT_CURRENCY_MISMATCH');
  }
}

/** The debit account is a card's linked account, which cannot pay a card (AC-05, spec D6). */
export class DebitAccountIsCardAccount extends AppError {
  constructor() {
    super('DEBIT_ACCOUNT_IS_CARD_ACCOUNT');
  }
}

/** A new debit link points at an archived account. */
export class DebitAccountArchived extends AppError {
  constructor() {
    super('ACCOUNT_ARCHIVED');
  }
}

/** The purchase date, in the user's time zone, is after today (the rule movements apply to expenses). */
export class InstallmentPurchaseDateInFuture extends AppError {
  constructor() {
    super('MOVEMENT_DATE_IN_FUTURE', 'the purchase date is after today', ['body.purchasedOn']);
  }
}

/** The first period of an installment purchase is not a `YYYY-MM` month. */
export class InvalidFirstPeriod extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'the first period must be a YYYY-MM month', ['body.firstPeriod']);
  }
}
