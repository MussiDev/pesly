import type { ApiFailure } from '@/lib/api-client';
import type { GroupFieldErrors } from './group-request';

export interface GroupFormErrors {
  /** A full catalog path. */
  form?: string;
  fields?: GroupFieldErrors;
}

/** A full catalog path: API failures live under `errors`. */
export function failurePath(failure: ApiFailure): `errors.${ApiFailure['messageKey']}` {
  return `errors.${failure.messageKey}`;
}

/** Form errors for a failed create: a rejected `name` goes next to its field. */
export function createFailureErrors(failure: ApiFailure): GroupFormErrors {
  const rejectsName =
    failure.code === 'VALIDATION_FAILED' &&
    (failure.fields ?? []).some((name) => name === 'body.name' || name === 'name');
  if (rejectsName) return { fields: { name: 'groups.list.errors.nameInvalid' } };
  return { form: failurePath(failure) };
}
