'use client';

import {
  RATE_AGE_WARNING_MS,
  formatRateInput,
  instantToZonedLocal,
  rateAgeMs,
  type AccountResponse,
  type CategoryResponse,
  type ExchangeRate,
  type ProfileResponse,
  type RateType,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { AccountsLoadState } from '@/features/accounts/components/accounts-load-state';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { readReferenceCopy, writeReferenceCopy } from '@/lib/local-store/device-copy';
import { readSessionPointer } from '@/lib/local-store/session-pointer';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;

export interface MovementFormData {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  /** The user's tags, for suggestions while there is no connection; empty on the edit screen. */
  tags: string[];
  timeZone: string;
  rateType: RateType;
  /** The default rate type's stored sell price, formatted for the locale; empty without one. */
  defaultRate: string;
  rateAgeHours: number | undefined;
  defaultOccurredAt: string;
  /** `true` when the screen is built from the copy kept on the device instead of from the API. */
  offline: boolean;
}

export type MovementFormDataState = AccountsLoadState | { kind: 'ready'; data: MovementFormData };

/** Reads every page of a list, 100 at a time; an empty page ends the loop even on a stale total. */
export async function loadAll<T>(
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

interface FormDataSource {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  tags: string[];
  preferences: ProfileResponse['preferences'];
  rates: ExchangeRate[];
  locale: string;
  offline: boolean;
}

function buildFormData(source: FormDataSource): MovementFormData {
  const { timeZone, defaultRateType } = source.preferences;
  const now = new Date();
  // Without readable rates the screen still works: the rate is then empty and required.
  const stored = source.rates.find((entry) => entry.rateType === defaultRateType);
  const age = stored === undefined ? 0 : rateAgeMs(stored, now);
  return {
    accounts: source.accounts,
    categories: source.categories,
    tags: source.tags,
    timeZone,
    rateType: defaultRateType,
    defaultRate: stored === undefined ? '' : formatRateInput(BigInt(stored.sell), source.locale),
    rateAgeHours: age > RATE_AGE_WARNING_MS ? Math.floor(age / HOUR_MS) : undefined,
    defaultOccurredAt: instantToZonedLocal(now, timeZone),
    offline: source.offline,
  };
}

/**
 * What the entry and edit screens need before they render: the profile (time zone, default rate
 * type), the accounts and categories, and the stored rates. Archived accounts and categories are
 * loaded only on request (an edit may keep one the movement already uses).
 *
 * The entry screen also keeps a copy on the device: every online load writes it, and when the device
 * is offline, or a request fails with a network error, the screen is built from that copy instead.
 * A 401 goes to sign in and never uses the copy.
 */
export function useMovementFormData({
  includeArchived = false,
}: { includeArchived?: boolean } = {}) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const online = useOnlineStatus();
  const [state, setState] = useState<MovementFormDataState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      // Both screens read the copy of the user the device knows; only the entry screen writes it,
      // since the edit screen loads archived options the copy does not keep.
      const readUser = readSessionPointer()?.userId;
      const copyUser = includeArchived ? undefined : readUser;

      const showCopy = async (): Promise<boolean> => {
        const copy = await readReferenceCopy(readUser);
        if (!isActive()) return true;
        if (copy === null) return false;
        setState({ kind: 'ready', data: buildFormData({ ...copy, locale, offline: true }) });
        return true;
      };

      if (!online) {
        // No request at all while offline: the copy is the only source.
        if (!(await showCopy()) && isActive()) {
          setState({ kind: 'failed', error: 'offlineNoCopy' });
        }
        return;
      }

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
      const tagList: Promise<ApiResult<string[]>> | undefined =
        copyUser === undefined
          ? undefined
          : loadAll((offset) =>
              api.listAllTags({ limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
            );
      const [
        profile,
        openAccounts,
        openCategories,
        rates,
        archivedAccounts,
        archivedCategories,
        tags,
      ] = await Promise.all([
        api.getProfile(),
        open.accounts,
        open.categories,
        api.getLatestRates(),
        archived?.accounts,
        archived?.categories,
        tagList,
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
      const networkFailed = [profile, accounts, categories].some(
        (result) => !result.ok && result.code === 'NETWORK',
      );
      if (networkFailed && (await showCopy())) return;
      if (!isActive()) return;
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

      const freshRates = rates.ok ? rates.data.rates : [];
      // A failed tag list keeps the tags of the last copy instead of replacing them with none.
      const previous = tags?.ok === false ? await readReferenceCopy(copyUser) : null;
      const tagNames = tags?.ok ? tags.data : (previous?.tags ?? []);
      if (!isActive()) return;
      setState({
        kind: 'ready',
        data: buildFormData({
          accounts: accounts.data,
          categories: categories.data,
          tags: tagNames,
          preferences: profile.data.preferences,
          rates: freshRates,
          locale,
          offline: false,
        }),
      });
      if (copyUser !== undefined) {
        void writeReferenceCopy(copyUser, {
          accounts: accounts.data.filter((item) => !item.archived),
          categories: categories.data.filter((item) => !item.archived),
          tags: tagNames,
          preferences: profile.data.preferences,
          rates: freshRates,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, router, locale, attempt, includeArchived, online]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}
