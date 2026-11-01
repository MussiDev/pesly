'use client';

import {
  instantToZonedLocal,
  type AccountResponse,
  type CategoryResponse,
  type ExpenseOptionsResponse,
} from '@pesly/shared';
import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import {
  categoryLabel,
  compareCategories,
  compareGroupCategories,
} from '@/features/categories/category-display';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure, ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { readDeviceContext } from '@/lib/device-context';
import { groupCategoryLabel } from '../../components/group-categories-list';
import { GroupNotFoundView } from '../../components/group-not-found';
import { GroupsLoadStateView, type GroupsLoadState } from '../../components/groups-load-state';
import { isGroupId } from '../../group-id';
import { createSplitState } from '../../split/split-state';
import { ExpenseForm } from './expense-form';
import {
  buildExpenseRequest,
  initialSplitState,
  type ExpenseFieldErrors,
  type ExpenseFormValues,
} from './expense-request';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const FALLBACK_TIME_ZONE = 'America/Argentina/Buenos_Aires';

interface FormData {
  options: ExpenseOptionsResponse;
  accounts: AccountResponse[];
  personalCategories: CategoryResponse[];
  initialValues: ExpenseFormValues;
}

type ScreenState = GroupsLoadState | { kind: 'ready'; data: FormData };

interface ExpenseFormContainerProps {
  groupId: string;
  /** The user's IANA time zone; the device's when absent. */
  timeZone?: string;
  /** The current instant, injectable for tests. */
  now?: Date;
}

/** The new group expense screen: 3 requests to load, one to save. Online only. */
export function ExpenseFormContainer(props: ExpenseFormContainerProps) {
  if (!isGroupId(props.groupId)) return <GroupNotFoundView />;
  return <ExpenseFormScreen {...props} />;
}

function ExpenseFormScreen({ groupId, timeZone: timeZoneProp, now }: ExpenseFormContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const tForm = useTranslations('groups.expenses.form');
  const timeZone = timeZoneProp ?? readDeviceContext().timeZone ?? FALLBACK_TIME_ZONE;
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldErrors>({});
  const [issue, setIssue] = useState<ApiFailure>();

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const [options, accounts, categories] = await Promise.all([
        api.getExpenseOptions(groupId),
        loadAll((offset) =>
          api.listAccounts({
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        loadAll((offset) =>
          api.listCategories({
            kind: 'expense',
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
      ]);
      if (!isActive()) return;
      const results: ApiResult<unknown>[] = [options, accounts, categories];
      for (const result of results) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      if (!options.ok) setState({ kind: 'failed', error: options.messageKey });
      else if (!accounts.ok) setState({ kind: 'failed', error: accounts.messageKey });
      else if (!categories.ok) setState({ kind: 'failed', error: categories.messageKey });
      else {
        const memberIds = options.data.members.map((member) => member.id);
        const payer = memberIds.includes(options.data.selfMemberId)
          ? options.data.selfMemberId
          : (memberIds[0] ?? '');
        const split = memberIds.length
          ? initialSplitState(options.data.defaultSplit, memberIds, payer)
          : createSplitState(0n, payer, []);
        setState({
          kind: 'ready',
          data: {
            options: options.data,
            accounts: accounts.data,
            personalCategories: categories.data,
            initialValues: {
              amount: '',
              currency: 'ARS',
              occurredAt: instantToZonedLocal(now ?? new Date(), timeZone),
              payerMemberId: payer,
              categoryId: '',
              description: '',
              payerAccountId: '',
              payerCategoryId: '',
              split,
            },
          },
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, router, groupId, timeZone, now, attempt]);

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

  const { options, accounts, personalCategories, initialValues } = state.data;
  const members = options.members.map((member) => ({
    id: member.id,
    name: member.displayName ?? tForm('unnamedMember'),
  }));

  async function submit(values: ExpenseFormValues) {
    if (pending) return;
    const result = buildExpenseRequest(values, {
      members,
      groupCategories: options.categories,
      accounts,
      personalCategoryIds: personalCategories.map((category) => category.id),
      currentMemberId: options.selfMemberId,
      timeZone,
      locale,
      now: now ?? new Date(),
    });
    if (result.request === undefined) {
      setIssue(undefined);
      setFieldErrors(result.fields);
      return;
    }
    setFieldErrors({});
    setIssue(undefined);
    setPending(true);
    const created = await api.createGroupExpense(groupId, result.request);
    setPending(false);
    if (created.ok) router.push(`/groups/${encodeURIComponent(groupId)}/expenses`);
    else if (created.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setIssue(created);
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={tForm('title')} />
      <ExpenseForm
        members={members}
        categories={options.categories
          .filter((category) => category.archivedAt === null)
          .sort(compareGroupCategories)
          .map((category) => ({
            id: category.id,
            label: groupCategoryLabel(category, language),
            icon: category.icon,
            color: category.color,
          }))}
        accounts={accounts}
        personalCategories={[...personalCategories].sort(compareCategories).map((category) => ({
          id: category.id,
          label: categoryLabel(category, language),
          parentId: category.parentId,
          icon: category.icon,
          color: category.color,
        }))}
        currentMemberId={options.selfMemberId}
        initialValues={initialValues}
        fieldErrors={fieldErrors}
        issue={issue}
        pending={pending}
        onSubmit={(values) => {
          void submit(values);
        }}
      />
    </div>
  );
}
