import type { ApiFailure } from '@/lib/api-client';

/** A full catalog path: API failures live under `errors`. */
export function failurePath(failure: ApiFailure): `errors.${ApiFailure['messageKey']}` {
  return `errors.${failure.messageKey}`;
}
