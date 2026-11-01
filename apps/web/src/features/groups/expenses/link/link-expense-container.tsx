'use client';

import type { AccountResponse, CategoryResponse, GroupExpenseResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { categoryLabel, compareCategories } from '@/features/categories/category-display';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure, ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { readDeviceContext } from '@/lib/device-context';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { GroupsLoadStateView, type GroupsLoadState } from '../../components/groups-load-state';
import { isGroupId } from '../../group-id';
import { LinkExpenseView, type CandidatesState } from './link-expense-view';
import { buildLinkRequest, type LinkFieldErrors, type LinkWay } from './link-request';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const FALLBACK_TIME_ZONE = 'America/Argentina/Buenos_Aires';

interface Loaded {
  expense: GroupExpenseResponse;
  accounts: AccountResponse[];
  personalCategories: CategoryResponse[];
}

type Screen =
  | GroupsLoadState
  | { kind: 'notFound' }
  | { kind: 'notPayer' }
  | { kind: 'alreadyLinked' }
  | { kind: 'ready'; data: Loaded };

type NoticeKey = 'offline' | 'notFound' | 'notPayer' | 'alreadyLinked';

function NoticeCard({ groupId, messageKey }: { groupId: string; messageKey: NoticeKey }) {
  const t = useTranslations('groups.expenses.link');
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <p role="alert">{t(messageKey)}</p>
        <Link
          href={`/groups/${encodeURIComponent(groupId)}/expenses`}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {t('back')}
        </Link>
      </CardContent>
    </Card>
  );
}

interface LinkExpenseContainerProps {
  groupId: string;
  expenseId: string;
  /** The user's IANA time zone; the device's when absent. */
  timeZone?: string;
}

/**
 * Links an expense paid by the caller to one of their own accounts (FEAT-008): the expense, the
 * caller's membership, their accounts and personal categories to load, the candidates to adopt, and
 * one request to link. Online only.
 */
export function LinkExpenseContainer(props: LinkExpenseContainerProps) {
  if (!isGroupId(props.groupId) || !isGroupId(props.expenseId)) {
    return <NoticeCard groupId={props.groupId} messageKey="notFound" />;
  }
  return <LinkExpenseScreen {...props} />;
}

function LinkExpenseScreen({
  groupId,
  expenseId,
  timeZone: timeZoneProp,
}: LinkExpenseContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const t = useTranslations('groups.expenses.link');
  const online = useOnlineStatus();
  const timeZone = timeZoneProp ?? readDeviceContext().timeZone ?? FALLBACK_TIME_ZONE;
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [candidates, setCandidates] = useState<CandidatesState>({ kind: 'loading' });
  const [candidatesAttempt, setCandidatesAttempt] = useState(0);
  const [way, setWay] = useState<LinkWay>('create');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [movementId, setMovementId] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LinkFieldErrors>({});
  const [issue, setIssue] = useState<ApiFailure>();
  const ready = screen.kind === 'ready';

  useEffect(() => {
    if (!online) return;
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const [expense, options, accounts, categories] = await Promise.all([
        api.getGroupExpense(groupId, expenseId),
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
      const results: ApiResult<unknown>[] = [expense, options, accounts, categories];
      for (const result of results) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      const missing = results.find((result) => !result.ok && result.code === 'NOT_FOUND');
      if (missing !== undefined) {
        setScreen({ kind: 'notFound' });
        return;
      }
      if (!expense.ok) setScreen({ kind: 'failed', error: expense.messageKey });
      else if (!options.ok) setScreen({ kind: 'failed', error: options.messageKey });
      else if (!accounts.ok) setScreen({ kind: 'failed', error: accounts.messageKey });
      else if (!categories.ok) setScreen({ kind: 'failed', error: categories.messageKey });
      else if (expense.data.payerMemberId !== options.data.selfMemberId) {
        setScreen({ kind: 'notPayer' });
      } else if (expense.data.payerMovementId !== null) setScreen({ kind: 'alreadyLinked' });
      else {
        setScreen({
          kind: 'ready',
          data: {
            expense: expense.data,
            accounts: accounts.data,
            personalCategories: categories.data,
          },
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, router, groupId, expenseId, online, attempt]);

  useEffect(() => {
    if (!online || !ready) return;
    let active = true;
    const isActive = () => active;
    setCandidates({ kind: 'loading' });
    void (async () => {
      const result = await api.getMovementCandidates(groupId, expenseId);
      if (!isActive()) return;
      if (result.ok) {
        setCandidates({
          kind: 'ready',
          items: result.data.items.map((item) => ({
            id: item.id,
            title: item.note ?? t('noNote'),
            detail: t('candidateDetail', {
              account: item.accountName,
              date: formatDateTime(item.occurredAt, timeZone, language),
            }),
          })),
        });
      } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setCandidates({ kind: 'failed' });
    })();
    return () => {
      active = false;
    };
    // The labels only need the language and the zone the screen was opened with.
  }, [api, router, groupId, expenseId, online, ready, candidatesAttempt, language, timeZone, t]);

  if (!online) return <NoticeCard groupId={groupId} messageKey="offline" />;
  if (screen.kind === 'notFound') return <NoticeCard groupId={groupId} messageKey="notFound" />;
  if (screen.kind === 'notPayer') return <NoticeCard groupId={groupId} messageKey="notPayer" />;
  if (screen.kind === 'alreadyLinked') {
    return <NoticeCard groupId={groupId} messageKey="alreadyLinked" />;
  }
  if (screen.kind === 'loading' || screen.kind === 'failed') {
    return (
      <GroupsLoadStateView
        state={screen}
        onRetry={() => {
          setScreen({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { expense, accounts, personalCategories } = screen.data;

  async function submit() {
    if (pending) return;
    const result = buildLinkRequest({ way, accountId, categoryId, movementId });
    if (result.request === undefined) {
      setIssue(undefined);
      setFieldErrors(result.fields);
      return;
    }
    setFieldErrors({});
    setIssue(undefined);
    setPending(true);
    const linked = await api.linkPayerMovement(groupId, expenseId, result.request);
    setPending(false);
    if (linked.ok) router.push(`/groups/${encodeURIComponent(groupId)}/expenses`);
    else if (linked.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // In the adopt way a 404 most likely means the chosen movement is gone; keep the choices.
    else if (linked.code === 'NOT_FOUND' && way === 'create') setScreen({ kind: 'notFound' });
    else setIssue(linked);
  }

  return (
    <LinkExpenseView
      summary={t('summary', {
        description: expense.description,
        amount: formatMoney(BigInt(expense.amount), expense.currency, language),
        date: formatDateTime(expense.occurredAt, timeZone, language),
      })}
      way={way}
      onWayChange={(next) => {
        setFieldErrors({});
        setIssue(undefined);
        setWay(next);
      }}
      accounts={accounts
        .filter((account) => !account.archived && account.currency === expense.currency)
        .map((account) => ({ id: account.id, name: account.name }))}
      categories={[...personalCategories].sort(compareCategories).map((category) => ({
        id: category.id,
        label: categoryLabel(category, language),
        parentId: category.parentId,
        icon: category.icon,
        color: category.color,
      }))}
      accountId={accountId}
      categoryId={categoryId}
      onAccountChange={setAccountId}
      onCategoryChange={setCategoryId}
      candidates={candidates}
      movementId={movementId}
      onMovementChange={setMovementId}
      onRetryCandidates={() => {
        setCandidatesAttempt((current) => current + 1);
      }}
      fieldErrors={fieldErrors}
      issue={issue}
      pending={pending}
      onSubmit={() => {
        void submit();
      }}
    />
  );
}
