import type { ApiFailure } from '@/lib/api-client';
import { budgetFailureKey } from '../helpers/budget-failure';

/** The catalog path shown above the form for a failed request. */
export function formFailureMessage(failure: ApiFailure): string {
  const key = budgetFailureKey(failure);
  return key.kind === 'not-found' ? 'errors.unexpected' : key.key;
}
