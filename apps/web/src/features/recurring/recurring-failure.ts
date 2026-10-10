import type { ApiFailure } from '@/lib/api-client';
import type { RecurringFormErrors } from './components/recurring-payment-form';

/** A full catalog path: API failures live under `errors`. */
export function failurePath(failure: ApiFailure): `errors.${ApiFailure['messageKey']}` {
  return `errors.${failure.messageKey}`;
}

/** The API names an invalid body field `body.<name>`; the bare name is accepted too. */
function rejectsReminderDays(failure: ApiFailure): boolean {
  return (
    failure.code === 'VALIDATION_FAILED' &&
    (failure.fields ?? []).some((name) => name === 'body.reminderDays' || name === 'reminderDays')
  );
}

/** Form errors for a failed save: a rejected `reminderDays` goes next to its field. */
export function saveFailureErrors(failure: ApiFailure): RecurringFormErrors {
  if (rejectsReminderDays(failure)) {
    return { fields: { reminderDays: 'recurring.errors.reminderDaysInvalid' } };
  }
  return { form: failurePath(failure) };
}
