'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline } from '@/lib/connectivity';
import { loadAccountOptions, type ReportAccountOption } from './load-account-options';

/**
 * The account selector's options. They load once online and again when the connection returns,
 * because a failed or offline first load leaves the list empty; options already loaded are kept
 * when a later load comes back empty.
 */
export function useAccountOptions(): ReportAccountOption[] {
  const t = useTranslations('reports');
  const api = useApiClient();
  const [accounts, setAccounts] = useState<ReportAccountOption[]>([]);
  const [reconnects, setReconnects] = useState(0);

  useEffect(() => {
    const onOnline = () => {
      setReconnects((value) => value + 1);
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (isOffline()) return;
    let active = true;
    void loadAccountOptions(api, (name) => t('filters.archivedAccount', { name })).then(
      (options) => {
        if (active) setAccounts((current) => (options.length === 0 ? current : options));
      },
    );
    return () => {
      active = false;
    };
  }, [api, t, reconnects]);

  return accounts;
}
