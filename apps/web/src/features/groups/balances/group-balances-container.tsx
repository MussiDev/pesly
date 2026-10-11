'use client';

import type { BalancesResponse, GroupDetailResponse } from '@pesly/shared';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from '../components/group-issue';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import {
  SettlementFormContainer,
  type SettlementPrefill,
} from '../settlement-form/settlement-form-container';
import { buildBalanceView, type PaymentRow } from '../settlements/balance-view';
import { BalancesByCurrency } from './balances-by-currency';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | { kind: 'ready'; group: GroupDetailResponse; balances: BalancesResponse };

interface OpenForm {
  /** Remounts the form when it is opened again on another suggestion. */
  key: number;
  initial: SettlementPrefill | null;
}

/** The balances of one group per currency, the suggested payments and the form to record one. */
export function GroupBalancesContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.balances');
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<OpenForm | null>(null);
  const [reloadIssue, setReloadIssue] = useState<ApiFailure>();

  useEffect(() => {
    let active = true;
    void Promise.all([api.getGroup(groupId), api.getGroupBalances(groupId)]).then(
      ([group, balances]) => {
        if (!active) return;
        const failed = !group.ok ? group : !balances.ok ? balances : undefined;
        if (group.ok && balances.ok) {
          setState({ kind: 'ready', group: group.data, balances: balances.data });
        } else if (failed?.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (failed?.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else if (failed !== undefined) setState({ kind: 'failed', error: failed.messageKey });
      },
    );
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  const view = useMemo(
    () =>
      state.kind === 'ready'
        ? buildBalanceView(state.balances, state.group, state.group.selfMemberId)
        : [],
    [state],
  );

  if (state.kind === 'not-found') {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {t('notFound.back')}
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

  const { group } = state;
  const base = `/groups/${encodeURIComponent(group.id)}`;

  async function reloadBalances() {
    setReloadIssue(undefined);
    const result = await api.getGroupBalances(groupId);
    if (result.ok) {
      setState((current) =>
        current.kind === 'ready' ? { ...current, balances: result.data } : current,
      );
    } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setReloadIssue(result);
  }

  function openForm(initial: SettlementPrefill | null) {
    setForm((current) => ({ key: (current?.key ?? 0) + 1, initial }));
  }

  function openSuggestion(currency: SettlementPrefill['currency'], payment: PaymentRow) {
    openForm({
      fromMemberId: payment.fromMemberId,
      toMemberId: payment.toMemberId,
      amount: payment.amount,
      currency,
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={group.name}
        description={t('description')}
        actions={
          <>
            <Button
              onClick={() => {
                openForm(null);
              }}
            >
              {t('recordPayment')}
            </Button>
            <Link href={`${base}/settlements`} className={buttonVariants({ variant: 'outline' })}>
              {t('historyLink')}
            </Link>
            <Link
              href={`${base}/settlements/consolidate`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('consolidateLink')}
            </Link>
          </>
        }
      />
      {reloadIssue === undefined ? null : (
        <div className="grid gap-2">
          <GroupIssue failure={reloadIssue} />
          <p className="text-small text-muted-foreground">{t('reloadFailed')}</p>
          <RetryButton
            onRetry={() => {
              void reloadBalances();
            }}
          />
        </div>
      )}
      {form === null ? null : (
        <SettlementFormContainer
          key={form.key}
          groupId={group.id}
          selfMemberId={group.selfMemberId}
          members={group.members}
          initial={form.initial}
          onRecorded={() => {
            setForm(null);
            void reloadBalances();
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      )}
      {view.map((currencyView) => (
        <BalancesByCurrency
          key={currencyView.currency}
          view={currencyView}
          onRecord={(payment) => {
            openSuggestion(currencyView.currency, payment);
          }}
        />
      ))}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('app');
  return (
    <Button variant="outline" className="w-fit" onClick={onRetry}>
      {t('retry')}
    </Button>
  );
}
