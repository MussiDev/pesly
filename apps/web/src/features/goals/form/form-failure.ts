import type { ApiFailure } from '@/lib/api-client';
import { goalFailureKey } from '../helpers/goal-failure';

/** The catalog path shown above the form for a failed request. */
export function formFailureMessage(failure: ApiFailure): string {
  const key = goalFailureKey(failure);
  return key.kind === 'not-found' ? 'errors.unexpected' : key.key;
}
