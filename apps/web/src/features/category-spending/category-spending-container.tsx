'use client';

import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { isMonth } from './category-spending-month';
import { CategorySpendingScreen, type CategorySpendingState } from './category-spending-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads `?id=` and `?month=` and loads what the category adds up to in that month. */
export function CategorySpendingContainer() {
  const locale = useLocale() as Locale;
  const api = useApiClient();
  const router = useRouter();
  const online = useOnlineStatus();
  const params = useSearchParams();
  const id = params.get('id');
  const monthParam = params.get('month');
  const valid = id !== null && UUID.test(id) && isMonth(monthParam);
  const month = isMonth(monthParam) ? monthParam : '';
  const [state, setState] = useState<CategorySpendingState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) {
      setState({ status: 'notFound' });
      return;
    }
    if (!online) {
      setState({ status: 'offline' });
      return;
    }
    setState({ status: 'loading' });
    let live = true;
    void api.getCategoryDetail({ categoryId: id, month }).then((result) => {
      if (!live) return;
      if (result.ok) setState({ status: 'ready', data: result.data });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (result.code === 'NOT_FOUND' || result.code === 'VALIDATION_FAILED')
        setState({ status: 'notFound' });
      else setState({ status: 'failed' });
    });
    return () => {
      live = false;
    };
  }, [api, router, id, month, valid, online, attempt]);

  return (
    <CategorySpendingScreen
      locale={locale}
      categoryId={id ?? ''}
      month={month}
      state={state}
      onRetry={() => {
        setAttempt((value) => value + 1);
      }}
    />
  );
}
