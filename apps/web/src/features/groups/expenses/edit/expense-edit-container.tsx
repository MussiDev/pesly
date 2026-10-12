'use client';

import type {
  ExpenseOptionsResponse,
  GroupDetailResponse,
  GroupExpenseResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { readDeviceContext } from '@/lib/device-context';
import { groupCategoryLabel } from '../../components/group-categories-list';
import { resolveCategory } from '../../category-views/resolve-category';
import { GroupsLoadStateView, type GroupsLoadState } from '../../components/groups-load-state';
import { GroupConflictContainer } from '../../containers/group-conflict-container';
import { buildExpenseEditRequest, expenseEditValues } from '../../edit/expense-edit-values';
import { canEditRecord, selfRole } from '../../edit/permissions';
import { useGroupChanges } from '../../edit/use-group-changes';
import { isGroupId } from '../../group-id';
import type { ExpenseFieldErrors, ExpenseFormValues } from '../form/expense-request';
import { ExpenseEditFormView, ExpenseEditNoticeView } from './expense-edit-view';

const FALLBACK_TIME_ZONE = 'America/Argentina/Buenos_Aires';

interface LoadedData {
  group: GroupDetailResponse;
  expense: GroupExpenseResponse;
  options: ExpenseOptionsResponse;
}

type ScreenState = GroupsLoadState | { kind: 'notFound' } | { kind: 'ready'; data: LoadedData };

interface ExpenseEditContainerProps {
  groupId: string;
  expenseId: string;
  /** The user's IANA time zone; the device's when absent. */
  timeZone?: string;
  /** The current instant, injectable for tests. */
  now?: Date;
}

/** The edit expense screen: 3 requests to load, none to save (the sync pass sends the change). */
export function ExpenseEditContainer(props: ExpenseEditContainerProps) {
  if (!isGroupId(props.groupId) || !isGroupId(props.expenseId)) {
    return (
      <ExpenseEditNoticeView
        notice="notFound"
        backHref={`/groups/${encodeURIComponent(props.groupId)}/expenses`}
      />
    );
  }
  return <ExpenseEditScreen {...props} />;
}

function ExpenseEditScreen({
  groupId,
  expenseId,
  timeZone: timeZoneProp,
  now,
}: ExpenseEditContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const tForm = useTranslations('groups.expenses.form');
  const tExpenses = useTranslations('groups.expenses');
  const timeZone = timeZoneProp ?? readDeviceContext().timeZone ?? FALLBACK_TIME_ZONE;
  const changes = useGroupChanges(groupId);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldErrors>({});
  const [unavailable, setUnavailable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listHref = `/groups/${encodeURIComponent(groupId)}/expenses`;

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const [group, expense, options] = await Promise.all([
        api.getGroup(groupId),
        api.getGroupExpense(groupId, expenseId),
        // Archived categories too, so the chip names the category of an expense whose one was archived.
        api.getExpenseOptions(groupId, { includeArchived: true }),
      ]);
      if (!isActive()) return;
      const results: ApiResult<unknown>[] = [group, expense, options];
      if (results.some((result) => !result.ok && result.code === 'UNAUTHENTICATED')) {
        router.replace('/sign-in');
        return;
      }
      if (results.some((result) => !result.ok && result.code === 'NOT_FOUND')) {
        setState({ kind: 'notFound' });
        return;
      }
      if (!group.ok) setState({ kind: 'failed', error: group.messageKey });
      else if (!expense.ok) setState({ kind: 'failed', error: expense.messageKey });
      else if (!options.ok) setState({ kind: 'failed', error: options.messageKey });
      else {
        setState({
          kind: 'ready',
          data: { group: group.data, expense: expense.data, options: options.data },
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, router, groupId, expenseId, attempt]);

  if (state.kind === 'notFound') {
    return <ExpenseEditNoticeView notice="notFound" backHref={listHref} />;
  }
  if (state.kind !== 'ready' || !changes.ready) {
    return (
      <GroupsLoadStateView
        state={state.kind === 'failed' ? state : { kind: 'loading' }}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { group, expense, options } = state.data;
  const allowed = canEditRecord(
    expense.createdByMemberId,
    group.selfMemberId,
    selfRole(group.members, group.selfMemberId),
  );
  if (!allowed) return <ExpenseEditNoticeView notice="notAllowed" backHref={listHref} />;

  const change = changes.changes.find((item) => item.kind === 'expense' && item.id === expense.id);
  const names = new Map<string, string>(
    [...group.members, ...group.formerMembers].map((member) => [
      member.id,
      member.displayName ?? tForm('unnamedMember'),
    ]),
  );
  const categories = options.categories;

  if (change?.conflict !== undefined) {
    return (
      <GroupConflictContainer
        kind="expense"
        id={expense.id}
        memberNames={Object.fromEntries(names)}
        categoryNames={Object.fromEntries(
          categories.map((category) => [category.id, groupCategoryLabel(category, language)]),
        )}
        onResolved={() => {
          // The record may have changed on the server meanwhile: load it again.
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }
  if (change?.operation === 'delete') {
    return <ExpenseEditNoticeView notice="queuedDelete" backHref={listHref} />;
  }

  const members = options.members.map((member) => ({
    id: member.id,
    name: member.displayName ?? tForm('unnamedMember'),
  }));
  const queuedRequest = change?.kind === 'expense' ? change.request : undefined;

  async function submit(values: ExpenseFormValues) {
    const result = buildExpenseEditRequest(values, {
      members,
      groupCategories: categories,
      timeZone,
      locale,
      now: now ?? new Date(),
    });
    if (result.request === undefined) {
      setUnavailable(false);
      setFieldErrors(result.fields);
      return;
    }
    setFieldErrors({});
    const stored = await changes.queueUpdate({
      kind: 'expense',
      base: expense,
      request: result.request,
    });
    if (stored) router.push(listHref);
    else setUnavailable(true);
  }

  async function remove() {
    setDeleting(true);
    const stored = await changes.queueDelete({ kind: 'expense', base: expense });
    setDeleting(false);
    if (stored) router.push(listHref);
    else setUnavailable(true);
  }

  return (
    <ExpenseEditFormView
      // A new revision (retry, discard, another save) starts the fields again from the queue.
      key={`${String(change?.revision ?? 0)}:${change?.rejection?.code ?? ''}`}
      category={resolveCategory(
        expense.categoryId,
        categories,
        language,
        tExpenses('uncategorized'),
      )}
      form={{
        members,
        categories: categories
          .filter((category) => category.archivedAt === null)
          .map((category) => ({ id: category.id, label: groupCategoryLabel(category, language) })),
        accounts: [],
        personalCategories: [],
        currentMemberId: options.selfMemberId,
        initialValues: expenseEditValues(expense, queuedRequest, { timeZone, locale }),
        fieldErrors,
        issue: undefined,
        pending: false,
        onSubmit: (values) => {
          void submit(values);
        },
        locked: { payerName: names.get(expense.payerMemberId) ?? tForm('unnamedMember') },
      }}
      rejectionCode={change?.rejection?.code}
      unavailable={unavailable || !changes.available}
      deleting={deleting}
      onRetry={() => {
        void changes.retry('expense', expense.id);
      }}
      onDiscard={() => {
        void changes.discard('expense', expense.id);
      }}
      onDelete={() => {
        void remove();
      }}
    />
  );
}
