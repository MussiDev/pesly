'use client';

import {
  RATE_AGE_WARNING_MS,
  formatRateInput,
  instantToZonedLocal,
  rateAgeMs,
  type AccountResponse,
  type CategoryResponse,
  type RateType,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { AccountsLoadState } from '@/features/accounts/components/accounts-load-state';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;

export interface MovementFormData {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  timeZone: string;
  rateType: RateType;
  /** The default rate type's stored sell price, formatted for the locale; empty without one. */
  defaultRate: string;
  rateAgeHours: number | undefined;
  defaultOccurredAt: string;
}

export type MovementFormDataState = AccountsLoadState | { kind: 'ready'; data: MovementFormData };

/** Reads every page of a list, 100 at a time; an empty page ends the loop even on a stale total. */
async function loadAll<T>(
  fetchPage: (offset: number) => Promise<ApiResult<{ items: T[]; total: number }>>,
): Promise<ApiResult<T[]>> {
  const items: T[] = [];
  for (;;) {
    const page = await fetchPage(items.length);
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (page.data.items.length === 0 || items.length >= page.data.total) {
      return { ok: true, data: items };
    }
  }
}

function merge<T>(open: ApiResult<T[]>, archived: ApiResult<T[]> | undefined): ApiResult<T[]> {
  if (!open.ok || archived === undefined) return open;
  return archived.ok ? { ok: true, data: [...open.data, ...archived.data] } : archived;
}

/**
 * What the entry and edit screens need before they render: the profile (time zone, default rate
 * type), the accounts and categories, and the stored rates. Archived accounts and categories are
 * loaded only on request (an edit may keep one the movement already uses). A 401 goes to sign in.
 */
export function useMovementFormData({
  includeArchived = false,
}: { includeArchived?: boolean } = {}) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const [state, setState] = useState<MovementFormDataState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const paged = (archived: boolean) => ({
        accounts: loadAll((offset) =>
          api.listAccounts({ archived, limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
        ),
        categories: loadAll((offset) =>
          api.listCategories({ archived, limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
        ),
      });
      const open = paged(false);
      const archived = includeArchived ? paged(true) : undefined;
      const [profile, openAccounts, openCategories, rates, archivedAccounts, archivedCategories] =
        await Promise.all([
          api.getProfile(),
          open.accounts,
          open.categories,
          api.getLatestRates(),
          archived?.accounts,
          archived?.categories,
        ]);
      if (!isActive()) return;
      const accounts = merge(openAccounts, archivedAccounts);
      const categories = merge(openCategories, archivedCategories);
      for (const result of [profile, accounts, categories, rates]) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      if (!profile.ok) {
        setState({ kind: 'failed', error: profile.messageKey });
        return;
      }
      if (!accounts.ok) {
        setState({ kind: 'failed', error: accounts.messageKey });
        return;
      }
      if (!categories.ok) {
        setState({ kind: 'failed', error: categories.messageKey });
        return;
      }

      const { timeZone, defaultRateType } = profile.data.preferences;
      const now = new Date();
      // Without readable rates the screen still works: the rate is then empty and required.
      const stored = rates.ok
        ? rates.data.rates.find((entry) => entry.rateType === defaultRateType)
        : undefined;
      const age = stored === undefined ? 0 : rateAgeMs(stored, now);
      setState({
        kind: 'ready',
        data: {
          accounts: accounts.data,
          categories: categories.data,
          timeZone,
          rateType: defaultRateType,
          defaultRate: stored === undefined ? '' : formatRateInput(BigInt(stored.sell), locale),
          rateAgeHours: age > RATE_AGE_WARNING_MS ? Math.floor(age / HOUR_MS) : undefined,
          defaultOccurredAt: instantToZonedLocal(now, timeZone),
        },
      });
    })();
    return () => {
      active = false;
    };
  }, [api, router, locale, attempt, includeArchived]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}
