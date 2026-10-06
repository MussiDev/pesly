import { messageKeyOf, type ApiErrorKey } from '@/lib/api-client';
import type { SyncFailure } from './sync-overlay';

/**
 * What a failed change says: an edit answered "not found" was deleted on another device (the
 * wording D4 of the spec chose); any other code shows its existing error message, and an unknown
 * one the generic message. The code itself is never shown.
 */
export function failureMessageKey(failure: SyncFailure): ApiErrorKey | 'deletedElsewhere' {
  if (failure.operation === 'update' && failure.code === 'NOT_FOUND') return 'deletedElsewhere';
  if (failure.code === 'NOT_FOUND') return 'unexpected';
  return messageKeyOf(failure.code);
}
