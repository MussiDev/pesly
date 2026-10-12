'use client';

import type { CategoryResponse } from '@pesly/shared';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';

export type BudgetCategoriesState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: CategoryResponse[] };

/** The first 100 active expense categories, in one request; `retry` asks again after a failure. */
export function useBudgetCategories(enabled: boolean): {
  state: BudgetCategoriesState;
  retry: () => void;
} {
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<BudgetCategoriesState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const result = await api.listCategories({ kind: 'expense', archived: false, limit: 100 });
    if (result.ok) {
      setState({ kind: 'ready', items: result.data.items });
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else {
      setState({ kind: 'failed' });
    }
  }, [api, router]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return {
    state,
    retry: () => {
      void load();
    },
  };
}
