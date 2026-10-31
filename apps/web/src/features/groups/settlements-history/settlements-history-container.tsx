'use client';

import type { GroupDetailResponse, SettlementPairTotal, SettlementResponse } from '@pesly/shared';
import { Users } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { onSyncFinished } from '@/lib/sync/sync-events';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import { canEditRecord, isConsolidatedSettlement, selfRole } from '../edit/permissions';
import { applyQueuedValues } from '../edit/queued-values';
import { useGroupChanges } from '../edit/use-group-changes';
import { overlayGroupRecords } from '../sync-overlay';
import type { SettlementRowData } from './settlement-row';
import { SettlementsEmptyState } from './settlements-empty-state';
import { SettlementsList } from './settlements-list';
import { SettlementsTotals, type SettlementTotalView } from './settlements-totals';

const PAGE_SIZE = 50;

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | {
      kind: 'ready';
      group: GroupDetailResponse;
      items: SettlementResponse[];
      nextCursor: string | null;
      totals: SettlementPairTotal[];
      loadingMore: boolean;
      moreFailed: boolean;
    };

/** Appends a page, dropping any settlement whose id is already shown (D10). */
function appendPage(shown: SettlementResponse[], page: SettlementResponse[]): SettlementResponse[] {
  const seen = new Set(shown.map((item) => item.id));
  const fresh: SettlementResponse[] = [];
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  return [...shown, ...fresh];
}

/**
 * The settlements of one group, read-only. The page makes two requests (NFR-02): the group, for
 * the names, and the first page; "load more" follows the cursor of the previous answer.
 */
export function SettlementsHistoryContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.settlements');
  const tDetail = useTranslations('groups.detail');
  const tEdit = useTranslations('groups.edit.common');
  const locale = useLocale();
  const language: Locale = locale === 'en' ? 'en' : 'es';
  const timeZone = useTimeZone() ?? 'UTC';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const changes = useGroupChanges(groupId);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const reloadGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getGroup(groupId),
      api.listSettlements(groupId, { limit: PAGE_SIZE }),
    ]).then(([group, page]) => {
      if (!active) return;
      if (
        (!group.ok && group.code === 'UNAUTHENTICATED') ||
        (!page.ok && page.code === 'UNAUTHENTICATED')
      ) {
        router.replace('/sign-in');
      } else if (!group.ok) {
        setState(
          group.code === 'NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'failed', error: group.messageKey },
        );
      } else if (!page.ok) {
        setState(
          page.code === 'NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'failed', error: page.messageKey },
        );
      } else {
        setState({
          kind: 'ready',
          group: group.data,
          items: appendPage([], page.data.items),
          nextCursor: page.data.nextCursor,
          totals: page.data.totals,
          loadingMore: false,
          moreFailed: false,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  useEffect(
    () =>
      // An applied change shows the server's values: the first page is read again (D13).
      onSyncFinished(() => {
        const generation = ++reloadGeneration.current;
        void api.listSettlements(groupId, { limit: PAGE_SIZE }).then((page) => {
          if (generation !== reloadGeneration.current || !page.ok) return;
          setState((current) =>
            current.kind === 'ready'
              ? {
                  ...current,
                  items: appendPage([], page.data.items),
                  nextCursor: page.data.nextCursor,
                  totals: page.data.totals,
                  moreFailed: false,
                }
              : current,
          );
        });
      }),
    [api, groupId],
  );

  if (state.kind === 'not-found') {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={tDetail('notFound.title')}
        description={tDetail('notFound.description')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {tDetail('notFound.back')}
          </Link>
        }
      />
    );
  }

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { group, items, nextCursor, totals, loadingMore, moreFailed } = state;
  const names = new Map<string, string>(
    [...group.members, ...group.formerMembers].map((member) => [
      member.id,
      member.displayName ?? tDetail('unnamed'),
    ]),
  );
  const nameOf = (id: string): string => names.get(id) ?? tDetail('unnamed');
  const role = selfRole(group.members, group.selfMemberId);
  const queueUsable = changes.ready && changes.available;
  const rows: SettlementRowData[] = overlayGroupRecords(
    'settlement',
    items,
    queueUsable ? changes.changes : [],
  ).map(({ record, syncState, failure, change }) => {
    const shown = applyQueuedValues(record, change);
    return {
      id: record.id,
      payer: nameOf(shown.fromMemberId),
      payee: nameOf(shown.toMemberId),
      amount: formatMoney(BigInt(shown.amount), shown.currency, language),
      date: formatDateTime(shown.occurredAt, timeZone, language),
      consolidated: isConsolidatedSettlement(record),
      syncState,
      ...(failure === undefined ? {} : { failureCode: failure.code }),
      allowed: queueUsable && canEditRecord(record.createdByMemberId, group.selfMemberId, role),
      editHref: `/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(record.id)}/edit`,
      confirmingDelete: confirmingId === record.id,
      deleting: confirmingId === record.id && deleting,
    };
  });
  const totalRows: SettlementTotalView[] = totals.map((total) => ({
    key: `${total.fromMemberId}|${total.toMemberId}|${total.currency}`,
    payer: nameOf(total.fromMemberId),
    payee: nameOf(total.toMemberId),
    amount: formatMoney(BigInt(total.amount), total.currency, language),
    count: total.count,
  }));
  const showUnavailable = (changes.ready && !changes.available) || actionFailed;

  function confirmDelete(id: string) {
    const record = items.find((item) => item.id === id);
    if (record === undefined || deleting) return;
    setDeleting(true);
    void changes.queueDelete({ kind: 'settlement', base: record }).then((stored) => {
      setDeleting(false);
      setConfirmingId(null);
      setActionFailed(!stored);
    });
  }

  function settle(work: Promise<boolean>) {
    void work.then((done) => {
      setActionFailed(!done);
    });
  }

  function loadMore() {
    // The cursor is the one the previous answer carried; it is never typed by the user.
    if (nextCursor === null || loadingMore) return;
    setState((current) =>
      current.kind === 'ready' ? { ...current, loadingMore: true, moreFailed: false } : current,
    );
    void api.listSettlements(groupId, { limit: PAGE_SIZE, cursor: nextCursor }).then((page) => {
      if (!page.ok && page.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
        return;
      }
      setState((current) => {
        if (current.kind !== 'ready') return current;
        if (!page.ok) return { ...current, loadingMore: false, moreFailed: true };
        return {
          ...current,
          items: appendPage(current.items, page.data.items),
          nextCursor: page.data.nextCursor,
          totals: page.data.totals,
          loadingMore: false,
          moreFailed: false,
        };
      });
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} description={group.name} />
      {showUnavailable ? (
        <p role="alert" className="text-small text-destructive">
          {tEdit('unavailable')}
        </p>
      ) : null}
      {rows.length > 0 && totalRows.length > 0 ? <SettlementsTotals totals={totalRows} /> : null}
      {rows.length === 0 ? (
        <SettlementsEmptyState groupId={groupId} />
      ) : (
        <SettlementsList
          rows={rows}
          hasMore={nextCursor !== null}
          loadingMore={loadingMore}
          moreFailed={moreFailed}
          onLoadMore={loadMore}
          onDelete={(id) => {
            setActionFailed(false);
            setConfirmingId(id);
          }}
          onConfirmDelete={confirmDelete}
          onCancelDelete={() => {
            setConfirmingId(null);
          }}
          onRetry={(id) => {
            settle(changes.retry('settlement', id));
          }}
          onDiscard={(id) => {
            settle(changes.discard('settlement', id));
          }}
        />
      )}
    </div>
  );
}
