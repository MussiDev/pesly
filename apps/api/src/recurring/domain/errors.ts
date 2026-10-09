import { AppError } from '@pesly/shared';

/** The occurrence was already confirmed or skipped, so it cannot be resolved again (AC-08). */
export class OccurrenceNotPending extends AppError {
  constructor() {
    super('RECURRING_OCCURRENCE_NOT_PENDING');
  }
}
