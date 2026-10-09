import { AppError } from '@pesly/shared';

/** The occurrence was already confirmed or skipped, so it cannot be resolved again (AC-08). */
export class OccurrenceNotPending extends AppError {
  constructor() {
    super('RECURRING_OCCURRENCE_NOT_PENDING');
  }
}

/** The user already has the maximum number of recurring payments (spec: per-user cap of 200). */
export class RecurringLimitReached extends AppError {
  constructor() {
    super('RECURRING_LIMIT_REACHED');
  }
}
