import { AppError, RetryableError } from '@pesly/shared';

/** The movement's date, in the user's time zone, is after today. */
export class MovementDateInFuture extends AppError {
  constructor() {
    super('MOVEMENT_DATE_IN_FUTURE');
  }
}

/** An automatic rate was requested but no rate is stored for the user's default rate type. */
export class RateRequired extends AppError {
  constructor() {
    super('RATE_REQUIRED');
  }
}

/** An expense needs an expense category and an income an income category. */
export class MovementCategoryKindMismatch extends AppError {
  constructor() {
    super('MOVEMENT_CATEGORY_KIND_MISMATCH');
  }
}

/** No movement can be recorded on an archived account. */
export class MovementAccountArchived extends AppError {
  constructor() {
    super('ACCOUNT_ARCHIVED');
  }
}

/** No movement can be recorded in an archived category. */
export class CategoryArchived extends AppError {
  constructor() {
    super('CATEGORY_ARCHIVED');
  }
}

/** Too many manual creations in the window; the caller may retry after `retryAfterSeconds`. */
export class MovementWriteRateLimited extends RetryableError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', retryAfterSeconds);
  }
}

/** A transfer or exchange needs two different accounts. */
export class MovementSameAccount extends AppError {
  constructor() {
    super('MOVEMENT_SAME_ACCOUNT');
  }
}

/** A transfer moves money between accounts of the same currency. */
export class MovementCurrencyMismatch extends AppError {
  constructor() {
    super('MOVEMENT_CURRENCY_MISMATCH');
  }
}

/** An exchange needs one ARS and one USD account. */
export class ExchangeSameCurrency extends AppError {
  constructor() {
    super('EXCHANGE_SAME_CURRENCY');
  }
}

/** The rate implied by the two amounts of an exchange is outside 1 to RATE_MAX scaled. */
export class ImpliedRateOutOfRange extends AppError {
  constructor() {
    super('IMPLIED_RATE_OUT_OF_RANGE');
  }
}
