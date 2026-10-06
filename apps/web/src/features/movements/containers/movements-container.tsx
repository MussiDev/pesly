'use client';

import type {
  AccountResponse,
  CategoryLanguage,
  CategoryResponse,
  MovementResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel, compareCategories } from '@/features/categories/category-display';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline, useOnlineStatus } from '@/lib/connectivity';
import {
  discardQueuedChange,
  readQueuedMovements,
  readRecentMovementsCopy,
  readReferenceCopy,
  retryQueuedChange,
  writeQueuedDelete,
  writeRecentMovementsCopy,
} from '@/lib/local-store/device-copy';
import type { QueuedMovement } from '@/lib/local-store/queue';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { notifyMovementQueued, onQueueChanged, onSyncFinished } from '@/lib/sync/sync-events';
import {
  MovementFilters,
  type FilterAccountOption,
  type FilterCategoryOption,
} from '../components/movement-filters';
import { MovementList, type MovementListItem } from '../components/movement-list';
import {
  MovementsLoadStateView,
  type MovementsLoadState,
} from '../components/movements-load-state';
import {
  filtersToListParams,
  hasActiveFilters,
  isRangeInvalid,
  parseFilters,
  serializeFilters,
  type MovementFilterValues,
} from '../movement-filters-state';
import { overlayQueue } from '../sync-overlay';
import { TagInputContainer } from './tag-input-container';

/** The API's largest page; also the size of each "show more" step. */
const PAGE_SIZE = 100;

/** Profile, accounts and categories: loaded once, apart from the filtered list. */
interface ReferenceData {
  timeZone: string;
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  /** Built from the copy kept on the device: only the active accounts and categories. */
  offline: boolean;
}

type ReferenceState = MovementsLoadState | { kind: 'ready'; data: ReferenceData };

interface ReadyList {
  kind: 'ready';
  movements: MovementResponse[];
  total: number;
  /** The filters this page was loaded with: "show more" keeps asking with these. */
  filtersKey: string;
  /** The movements come from the copy kept on the device, not from the API. */
  fromCopy?: boolean;
}

type ListState = MovementsLoadState | ReadyList;

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

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Every account, active ones first: an archived one still names old movements and filters them. */
function accountOptions(
  accounts: readonly AccountResponse[],
  archivedLabel: (name: string) => string,
): FilterAccountOption[] {
  return [...accounts]
    .sort((a, b) => Number(a.archived) - Number(b.archived))
    .map((account) => ({
      id: account.id,
      label: account.archived ? archivedLabel(account.name) : account.name,
    }));
}

/** Parents in catalog order, each followed by its subcategories; an orphan counts as a parent. */
function categoryOptions(
  categories: readonly CategoryResponse[],
  language: CategoryLanguage,
  archivedLabel: (name: string) => string,
): FilterCategoryOption[] {
  const ids = new Set(categories.map((category) => category.id));
  const sorted = [...categories].sort(compareCategories);
  const label = (category: CategoryResponse) => {
    const name = categoryLabel(category, language);
    return category.archived ? archivedLabel(name) : name;
  };
  return sorted
    .filter((category) => category.parentId === null || !ids.has(category.parentId))
    .flatMap((parent) => [
      { id: parent.id, label: label(parent), indent: false },
      ...sorted
        .filter((child) => child.parentId === parent.id)
        .map((child) => ({ id: child.id, label: label(child), indent: true })),
    ]);
}

function filtersFromKey(key: string): MovementFilterValues {
  return parseFilters(new URLSearchParams(key));
}

export function MovementsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const online = useOnlineStatus();
  const locale = useLocale();
  const tFilters = useTranslations('movements.filters');
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();

  const [reference, setReference] = useState<ReferenceState>({ kind: 'loading' });
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  // A malformed value in the URL is dropped here, once, by the shared schemas.
  const [filters, setFilters] = useState<MovementFilterValues>(() => filtersFromKey(urlKey));
  const filtersKey = serializeFilters(filters).toString();
  const rangeInvalid = isRangeInvalid(filters);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [listAttempt, setListAttempt] = useState(0);
  // The changes kept on this device that the server does not have yet (DISC-001-04c).
  const [queue, setQueue] = useState<QueuedMovement[]>([]);
  // Bumped whenever the queue changes, so it is read again.
  const [queueVersion, setQueueVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ErrorMessageKey | undefined>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<ErrorMessageKey | undefined>();
  // Bumped on every (re)load, so a "show more" answer from before it is discarded.
  const generation = useRef(0);
  // Both clear actions unmount the control that had focus; this moves it to the bar's first control.
  const firstFilterRef = useRef<HTMLSelectElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  // URLs this screen wrote that the router has not reported back yet.
  const pendingWrites = useRef<string[]>([]);

  // The address bar changed on its own (back button): follow it. Our own writes are skipped.
  useEffect(() => {
    const fromUrl = filtersFromKey(urlKey);
    const key = serializeFilters(fromUrl).toString();
    const written = pendingWrites.current.indexOf(key);
    if (written >= 0) {
      pendingWrites.current.splice(0, written + 1);
      return;
    }
    pendingWrites.current = [];
    setFilters((current) => (serializeFilters(current).toString() === key ? current : fromUrl));
  }, [urlKey]);

  useEffect(() => {
    if (focusRequest > 0) firstFilterRef.current?.focus();
  }, [focusRequest]);

  // A pass that sent movements changed the list on the server: load it again.
  useEffect(
    () =>
      onSyncFinished(() => {
        setListAttempt((value) => value + 1);
      }),
    [],
  );

  useEffect(
    () =>
      onQueueChanged(() => {
        setQueueVersion((value) => value + 1);
      }),
    [],
  );

  // The queue is read every time the list settles or the queue changes; one that cannot be read is
  // an empty one.
  useEffect(() => {
    if (list.kind !== 'ready') return;
    let live = true;
    void readQueuedMovements(readSessionPointer()?.userId).then((items) => {
      if (live) setQueue(items);
    });
    return () => {
      live = false;
    };
  }, [list, queueVersion]);

  function clearFilters() {
    applyFilters({});
    setFocusRequest((value) => value + 1);
  }

  function applyFilters(next: MovementFilterValues) {
    const query = serializeFilters(next).toString();
    pendingWrites.current.push(query);
    setFilters(next);
    router.replace(query === '' ? '/movements' : `/movements?${query}`, { scroll: false });
  }

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const copyUser = readSessionPointer()?.userId;
      const showCopy = async (): Promise<boolean> => {
        const copy = await readReferenceCopy(copyUser);
        if (!isActive()) return true;
        if (copy === null) return false;
        setReference({
          kind: 'ready',
          data: {
            timeZone: copy.preferences.timeZone,
            accounts: copy.accounts,
            categories: copy.categories,
            offline: true,
          },
        });
        return true;
      };
      if (!online) {
        // No request while offline: the copy of the last online visit is the only source.
        if (!(await showCopy()) && isActive()) {
          setReference({ kind: 'failed', error: 'offlineNoCopy' });
        }
        return;
      }
      const [profile, activeAccounts, archivedAccounts, activeCategories, archivedCategories] =
        await Promise.all([
          api.getProfile(),
          loadAll((offset) =>
            api.listAccounts({
              archived: false,
              limit: PAGE_SIZE,
              ...(offset > 0 ? { offset } : {}),
            }),
          ),
          loadAll((offset) =>
            api.listAccounts({
              archived: true,
              limit: PAGE_SIZE,
              ...(offset > 0 ? { offset } : {}),
            }),
          ),
          loadAll((offset) =>
            api.listCategories({
              archived: false,
              limit: PAGE_SIZE,
              ...(offset > 0 ? { offset } : {}),
            }),
          ),
          loadAll((offset) =>
            api.listCategories({
              archived: true,
              limit: PAGE_SIZE,
              ...(offset > 0 ? { offset } : {}),
            }),
          ),
        ]);
      if (!isActive()) return;
      const results = [
        profile,
        activeAccounts,
        archivedAccounts,
        activeCategories,
        archivedCategories,
      ];
      for (const result of results) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      const networkFailed = results.some((result) => !result.ok && result.code === 'NETWORK');
      if (networkFailed && (await showCopy())) return;
      if (!isActive()) return;
      for (const result of results) {
        if (!result.ok) {
          setReference({ kind: 'failed', error: result.messageKey });
          return;
        }
      }
      if (
        !profile.ok ||
        !activeAccounts.ok ||
        !archivedAccounts.ok ||
        !activeCategories.ok ||
        !archivedCategories.ok
      ) {
        return; // Unreachable: every failure returned above; this narrows the types.
      }
      setReference({
        kind: 'ready',
        data: {
          timeZone: profile.data.preferences.timeZone,
          accounts: [...activeAccounts.data, ...archivedAccounts.data],
          categories: [...activeCategories.data, ...archivedCategories.data],
          offline: false,
        },
      });
    })();
    return () => {
      active = false;
    };
  }, [api, router, referenceAttempt, online]);

  // Only the list reloads when a filter changes; the bar and the reference data stay as they are.
  useEffect(() => {
    generation.current += 1;
    setLoadingMore(false);
    setMoreError(undefined);
    const active = filtersFromKey(filtersKey);
    if (isRangeInvalid(active)) {
      // No request. The cleanup of the previous run already discarded any answer in flight, so a
      // list that was still loading settles on "no matches" instead of waiting forever.
      setList((current) =>
        current.kind === 'ready' ? current : { kind: 'ready', movements: [], total: 0, filtersKey },
      );
      return;
    }
    setList({ kind: 'loading' });
    let live = true;
    // A function, not the variable: TypeScript would narrow `live` to `true` across the await.
    const isLive = () => live;
    void (async () => {
      const copyUser = readSessionPointer()?.userId;
      const showSaved = async (): Promise<boolean> => {
        const saved = await readRecentMovementsCopy(copyUser);
        if (!isLive()) return true;
        if (saved === null) return false;
        setList({
          kind: 'ready',
          movements: saved,
          total: saved.length,
          filtersKey,
          fromCopy: true,
        });
        return true;
      };
      if (!online) {
        // No request while offline: the saved movements are shown, whatever the filters say.
        if (!(await showSaved()) && isLive()) {
          setList({ kind: 'failed', error: 'offlineNoCopy' });
        }
        return;
      }
      const first = await api.listMovements({ limit: PAGE_SIZE, ...filtersToListParams(active) });
      if (!isLive()) return;
      if (first.ok) {
        setList({
          kind: 'ready',
          movements: first.data.items,
          total: first.data.total,
          filtersKey,
        });
        // Only the newest page of an unfiltered list is the copy to keep.
        if (filtersKey === '' && copyUser !== undefined) {
          void writeRecentMovementsCopy(copyUser, first.data.items);
        }
      } else if (first.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
      } else if (first.code === 'NETWORK' && (await showSaved())) {
        // The saved movements are on screen.
      } else {
        setList({ kind: 'failed', error: first.messageKey });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, router, filtersKey, listAttempt, online]);

  /**
   * Keeps the delete on this device until it can be sent; the queue-changed event then hides the
   * row. When it cannot be stored the row stays and the person is told.
   */
  async function keepDeleteOnDevice(movement: MovementResponse): Promise<void> {
    const stored = await writeQueuedDelete(readSessionPointer()?.userId, movement);
    if (!stored) {
      setDeleteError('offlineSaveFailed');
      return;
    }
    // Online, the shell sends it right away; offline it waits for the connection.
    notifyMovementQueued();
  }

  async function remove(movement: MovementResponse) {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    // A movement with a change already waiting goes through the queue, so its changes keep order.
    if (isOffline() || queue.some((item) => item.id === movement.id)) {
      await keepDeleteOnDevice(movement);
      setDeleting(false);
      setConfirmingDeleteId(undefined);
      return;
    }
    const result = await api.deleteMovement(movement.id);
    if (!result.ok && result.code === 'NETWORK') await keepDeleteOnDevice(movement);
    setDeleting(false);
    setConfirmingDeleteId(undefined);
    if (!result.ok && result.code === 'NETWORK') return;
    // Already gone elsewhere (404) is what the user wanted: the reload drops the stale row.
    if (result.ok || result.code === 'NOT_FOUND') setListAttempt((value) => value + 1);
    else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setDeleteError(result.messageKey);
  }

  async function retry(id: string) {
    if (await retryQueuedChange(readSessionPointer()?.userId, id)) notifyMovementQueued();
  }

  async function discard(id: string) {
    if (await discardQueuedChange(readSessionPointer()?.userId, id)) {
      setListAttempt((value) => value + 1);
    }
  }

  async function showMore(current: ReadyList) {
    if (loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    setMoreError(undefined);
    const result = await api.listMovements({
      limit: PAGE_SIZE,
      offset: current.movements.length,
      ...filtersToListParams(filtersFromKey(current.filtersKey)),
    });
    // A reload replaced the list while this page was in flight: its offset no longer applies.
    if (requestGeneration !== generation.current) return;
    setLoadingMore(false);
    if (result.ok) {
      const next = result.data;
      setList((latest) =>
        latest.kind === 'ready'
          ? {
              ...latest,
              // A movement created between pages shifts the offsets and repeats a boundary row.
              movements: [
                ...latest.movements,
                ...next.items.filter(
                  (item) => !latest.movements.some((shown) => shown.id === item.id),
                ),
              ],
              // An empty page on a stale total ends the paging instead of looping on it.
              total: next.items.length === 0 ? latest.movements.length : next.total,
            }
          : latest,
      );
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else {
      setMoreError(result.messageKey);
    }
  }

  const referenceData = reference.kind === 'ready' ? reference.data : undefined;
  const accountChoices = useMemo(
    () =>
      referenceData === undefined
        ? []
        : accountOptions(referenceData.accounts, (name) => tFilters('archived', { name })),
    [referenceData, tFilters],
  );
  const categoryChoices = useMemo(
    () =>
      referenceData === undefined
        ? []
        : categoryOptions(referenceData.categories, language, (name) =>
            tFilters('archived', { name }),
          ),
    [referenceData, language, tFilters],
  );

  if (reference.kind !== 'ready') {
    return (
      <MovementsLoadStateView
        state={reference}
        onRetry={() => {
          setReference({ kind: 'loading' });
          setReferenceAttempt((value) => value + 1);
        }}
      />
    );
  }

  const viewingCopy = list.kind === 'ready' && list.fromCopy === true;
  const lookups = {
    accounts: indexById(reference.data.accounts),
    categories: indexById(reference.data.categories),
  };
  // Queued changes of movements outside the page go in by date, unless a filter is on (they were
  // never matched against it).
  const shownMovements =
    list.kind === 'ready'
      ? overlayQueue(list.movements, queue, {
          includeUnlisted: viewingCopy || !hasActiveFilters(filters),
          currencies: new Map(reference.data.accounts.map((entry) => [entry.id, entry.currency])),
        })
      : [];
  const items: MovementListItem[] =
    list.kind === 'ready'
      ? shownMovements.map(({ movement, syncState, failure }) => {
          const account = lookups.accounts.get(movement.accountId);
          const category =
            movement.categoryId === null ? undefined : lookups.categories.get(movement.categoryId);
          const destination =
            movement.destinationAccountId === null
              ? undefined
              : lookups.accounts.get(movement.destinationAccountId);
          return {
            movement,
            destinationAccountName: destination?.name,
            destinationCurrency: destination?.currency,
            accountName: account?.name,
            currency: account?.currency,
            categoryName: category === undefined ? undefined : categoryLabel(category, language),
            categoryIcon: category?.icon,
            categoryColor: category?.color,
            syncState,
            ...(failure === undefined ? {} : { failure }),
          };
        })
      : [];

  return (
    <MovementList
      items={items}
      timeZone={reference.data.timeZone}
      hasMore={list.kind === 'ready' && list.movements.length < list.total}
      loadingMore={loadingMore}
      moreError={moreError}
      rowActions={{
        confirmingDeleteId,
        pending: deleting,
        error: deleteError,
        onAskDelete: (id) => {
          setDeleteError(undefined);
          setConfirmingDeleteId(id);
        },
        onConfirmDelete: (id) => {
          const shown = items.find((item) => item.movement.id === id);
          if (shown !== undefined) void remove(shown.movement);
        },
        onCancelDelete: () => {
          setConfirmingDeleteId(undefined);
        },
        onRetry: (id) => {
          void retry(id);
        },
        onDiscard: (id) => {
          void discard(id);
        },
      }}
      onShowMore={() => {
        if (list.kind === 'ready') void showMore(list);
      }}
      filterBar={
        <MovementFilters
          filters={filters}
          accounts={accountChoices}
          categories={categoryChoices}
          rangeInvalid={rangeInvalid}
          onChange={applyFilters}
          onClear={clearFilters}
          disabled={viewingCopy}
          firstControlRef={firstFilterRef}
          renderTagField={({ value, onChange }) => (
            <TagInputContainer value={value} onChange={onChange} />
          )}
        />
      }
      filtersActive={!viewingCopy && hasActiveFilters(filters)}
      offlineNotice={viewingCopy}
      onClearFilters={clearFilters}
      loadState={list.kind === 'ready' ? undefined : list}
      onRetry={() => {
        setListAttempt((value) => value + 1);
      }}
    />
  );
}
