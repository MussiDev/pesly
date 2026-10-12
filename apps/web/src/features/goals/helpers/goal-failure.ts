import type { ApiFailure } from '@/lib/api-client';

export type GoalFailureKey =
  | { kind: 'not-found' }
  | { kind: 'offline'; key: 'errors.network' }
  | { kind: 'message'; key: `errors.${ApiFailure['messageKey']}` };

/** A missing or foreign goal and a lost connection are told apart; the rest show their own message. */
export function goalFailureKey(failure: ApiFailure): GoalFailureKey {
  if (failure.code === 'NOT_FOUND') return { kind: 'not-found' };
  if (failure.code === 'NETWORK') return { kind: 'offline', key: 'errors.network' };
  return { kind: 'message', key: `errors.${failure.messageKey}` };
}
