'use client';

import type { ExpenseOptionsResponse, GroupExpenseResponse } from '@pesly/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useApiClient } from '@/lib/api-client-provider';

/** How many expenses the group detail shows (FR-06). */
export const RECENT_EXPENSES_LIMIT = 5;

export type RecentExpensesState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'ready'; expenses: GroupExpenseResponse[]; options: ExpenseOptionsResponse };

export type FatalCode = 'UNAUTHENTICATED' | 'NOT_FOUND';

/**
 * The newest expenses of one group and the options that name their categories, loaded together.
 * A 401 or 404 is not a state of this section: it goes to `onFatal`, so the screen that owns
 * navigation decides what to show (AC-12). Any other failure leaves the section `failed`.
 */
export function useRecentExpenses(groupId: string, onFatal: (code: FatalCode) => void) {
  const api = useApiClient();
  const [state, setState] = useState<RecentExpensesState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const fatal = useRef(onFatal);
  fatal.current = onFatal;

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.listGroupExpenses(groupId, { limit: RECENT_EXPENSES_LIMIT }),
      api.getExpenseOptions(groupId),
    ]).then(([list, options]) => {
      if (!active) return;
      if (list.ok && options.ok) {
        setState({ kind: 'ready', expenses: list.data.items, options: options.data });
        return;
      }
      const failure = !list.ok ? list : !options.ok ? options : undefined;
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED' || failure.code === 'NOT_FOUND') {
        fatal.current(failure.code);
      } else {
        setState({ kind: 'failed', error: failure.messageKey });
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}
