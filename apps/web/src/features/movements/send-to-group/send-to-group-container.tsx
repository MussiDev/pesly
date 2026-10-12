'use client';

import type { AutomaticCategoryChange, ExpenseOptionsResponse, GroupResponse } from '@pesly/shared';
import { Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { groupCategoryLabel } from '@/features/groups/components/group-categories-list';
import {
  GroupsLoadStateView,
  type GroupsLoadState,
} from '@/features/groups/components/groups-load-state';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { readDeviceContext } from '@/lib/device-context';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { AUTOMATIC_CATEGORY, defaultSendSplit, pickOnlyGroup } from './send-defaults';
import {
  buildSendRequest,
  descriptionFromNote,
  type SendFieldErrors,
  type SendFormValues,
} from './send-request';
import { SendToGroupForm } from './send-to-group-form';

const FALLBACK_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const movementIdSchema = z.uuid();

interface Loaded {
  amount: bigint;
  currency: 'ARS' | 'USD';
  occurredAt: string;
  note: string | null;
  groups: GroupResponse[];
}

type Screen =
  | GroupsLoadState
  | { kind: 'notFound' }
  | { kind: 'alreadySent' }
  | { kind: 'ready'; data: Loaded };

type OptionsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'ready'; groupId: string; options: ExpenseOptionsResponse };

/** The route's query `id` is checked before any request; anything but a UUID is not found. */
export function SendToGroupRouteContainer() {
  const id = movementIdSchema.safeParse(useSearchParams().get('id'));
  if (!id.success) return <NoticeCard messageKey="notFound" />;
  return <SendToGroupContainer key={id.data} movementId={id.data} />;
}

function NoticeCard({ messageKey }: { messageKey: 'offline' | 'notFound' | 'alreadySent' }) {
  const t = useTranslations('movements.sendToGroup');
  const tMovements = useTranslations('movements');
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <p role="alert">{t(messageKey)}</p>
        <Link href="/movements" className={buttonVariants({ variant: 'ghost' })}>
          {tMovements('form.back')}
        </Link>
      </CardContent>
    </Card>
  );
}

interface SendToGroupContainerProps {
  movementId: string;
  /** The user's IANA time zone; the device's when absent. */
  timeZone?: string;
}

/**
 * Sends a movement to a group: movement, groups and the account (for its currency) to load, the
 * options of the chosen group, one request to send. Online only.
 */
export function SendToGroupContainer({
  movementId,
  timeZone: timeZoneProp,
}: SendToGroupContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const t = useTranslations('movements.sendToGroup');
  const tForm = useTranslations('groups.expenses.form');
  const online = useOnlineStatus();
  const timeZone = timeZoneProp ?? readDeviceContext().timeZone ?? FALLBACK_TIME_ZONE;
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [groupId, setGroupId] = useState<string>();
  const [optionsState, setOptionsState] = useState<OptionsState>({ kind: 'idle' });
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<SendFieldErrors>({});
  const [issue, setIssue] = useState<ApiFailure>();
  const [notice, setNotice] = useState<{ groupId: string; change: AutomaticCategoryChange }>();

  useEffect(() => {
    if (!online) return;
    let active = true;
    const isActive = () => active;
    void (async () => {
      const [movement, groups] = await Promise.all([api.getMovement(movementId), api.listGroups()]);
      if (!isActive()) return;
      const failed = !movement.ok ? movement : !groups.ok ? groups : undefined;
      if (failed !== undefined) {
        const first = failed;
        if (first.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (first.code === 'NOT_FOUND') setScreen({ kind: 'notFound' });
        else setScreen({ kind: 'failed', error: first.messageKey });
        return;
      }
      if (!movement.ok || !groups.ok) return;
      if (movement.data.groupExpense !== null) {
        setScreen({ kind: 'alreadySent' });
        return;
      }
      // The movement answer carries no currency: it is the account's.
      const account = await api.getAccount(movement.data.accountId);
      if (!isActive()) return;
      if (!account.ok) {
        if (account.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (account.code === 'NOT_FOUND') setScreen({ kind: 'notFound' });
        else setScreen({ kind: 'failed', error: account.messageKey });
        return;
      }
      setScreen({
        kind: 'ready',
        data: {
          amount: BigInt(movement.data.amount),
          currency: account.data.currency,
          occurredAt: movement.data.occurredAt,
          note: movement.data.note,
          groups: groups.data,
        },
      });
      setGroupId((current) => current ?? pickOnlyGroup(groups.data));
    })();
    return () => {
      active = false;
    };
  }, [api, router, movementId, online, attempt]);

  useEffect(() => {
    if (!online || groupId === undefined) return;
    let active = true;
    const isActive = () => active;
    setOptionsState({ kind: 'loading' });
    void (async () => {
      const options = await api.getExpenseOptions(groupId);
      if (!isActive()) return;
      if (options.ok) setOptionsState({ kind: 'ready', groupId, options: options.data });
      else if (options.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setOptionsState({ kind: 'failed', error: options.messageKey });
    })();
    return () => {
      active = false;
    };
  }, [api, router, groupId, online, optionsAttempt]);

  if (!online) return <NoticeCard messageKey="offline" />;
  if (screen.kind === 'notFound') return <NoticeCard messageKey="notFound" />;
  if (screen.kind === 'alreadySent') return <NoticeCard messageKey="alreadySent" />;
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

  if (notice) {
    return (
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <p role="status">
            {notice.change === 'created' ? t('categoryCreated') : t('categoryRestored')}
          </p>
          <Link
            href={`/groups/${encodeURIComponent(notice.groupId)}/expenses`}
            className={buttonVariants()}
          >
            {t('viewExpenses')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { data } = screen;
  if (data.groups.length === 0) {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={t('noGroups')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {t('goToGroups')}
          </Link>
        }
      />
    );
  }

  if (optionsState.kind === 'failed') {
    return (
      <GroupsLoadStateView
        state={optionsState}
        onRetry={() => {
          setOptionsAttempt((current) => current + 1);
        }}
      />
    );
  }

  const loaded =
    optionsState.kind === 'ready' && optionsState.groupId === groupId ? optionsState.options : null;
  const members = loaded?.members.map((member) => ({
    id: member.id,
    name: member.displayName ?? tForm('unnamedMember'),
  }));

  async function submit(values: SendFormValues) {
    if (pending || groupId === undefined || loaded === null) return;
    const result = buildSendRequest(values, {
      movementId,
      amount: data.amount,
      memberIds: loaded.members.map((member) => member.id),
      categories: loaded.categories,
      locale,
    });
    if (result.request === undefined) {
      setIssue(undefined);
      setFieldErrors(result.fields);
      return;
    }
    setFieldErrors({});
    setIssue(undefined);
    setPending(true);
    const sent = await api.sendMovementToGroup(groupId, result.request);
    setPending(false);
    if (sent.ok) {
      if (sent.data.autoCategory === null) {
        router.push(`/groups/${encodeURIComponent(groupId)}/expenses`);
      } else setNotice({ groupId, change: sent.data.autoCategory });
    } else if (sent.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else if (sent.code === 'NOT_FOUND') setScreen({ kind: 'notFound' });
    else setIssue(sent);
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('title')}
        description={t('summary', {
          amount: formatMoney(data.amount, data.currency, language),
          date: formatDateTime(data.occurredAt, timeZone, language),
        })}
      />
      <SendToGroupForm
        key={`${groupId ?? 'none'}:${loaded === null ? 'loading' : 'ready'}`}
        amount={data.amount}
        currency={data.currency}
        groups={data.groups.map((group) => ({ id: group.id, name: group.name }))}
        groupId={groupId}
        onChooseGroup={(id) => {
          setFieldErrors({});
          setIssue(undefined);
          setGroupId(id);
        }}
        options={
          loaded === null || members === undefined
            ? null
            : {
                members,
                categories: loaded.categories
                  .filter((category) => category.archivedAt === null)
                  .map((category) => ({
                    id: category.id,
                    label: groupCategoryLabel(category, language),
                  })),
              }
        }
        initialValues={{
          category: AUTOMATIC_CATEGORY,
          // Without a usable note the person gets an editable default, so 3 taps still suffice.
          description: descriptionFromNote(data.note) || t('defaultDescription'),
          split: defaultSendSplit({
            selfMemberId: loaded?.selfMemberId ?? '',
            members: loaded?.members ?? [],
          }),
        }}
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
