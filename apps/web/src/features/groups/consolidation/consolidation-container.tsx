'use client';

import {
  RATE_MAX_SCALED,
  formatRateInput,
  instantToZonedLocal,
  parseRateInput,
  type AccountCurrency,
  type ConsolidationPreview,
  type GroupDetailResponse,
} from '@pesly/shared';
import { CircleAlert, Users } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useFocusInvalid } from '@/features/profile/use-focus-invalid';
import { GroupIssue } from '../components/group-issue';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import {
  buildConsolidationRequest,
  type ConsolidationFieldErrors,
  type ConsolidationFieldMessage,
} from '../settlements/consolidation-request';
import {
  ConsolidationChoiceForm,
  type ConsolidationChoiceValues,
} from './consolidation-choice-form';
import { ConsolidationPreviewView } from './consolidation-preview';
import { ConsolidationRateField } from './consolidation-rate-field';
import { ConsolidationResult } from './consolidation-result';

type ScreenState =
  GroupsLoadState | { kind: 'not-found' } | { kind: 'ready'; group: GroupDetailResponse };

type PreviewOutcome =
  { kind: 'ready'; preview: ConsolidationPreview } | { kind: 'failed'; failure: ApiFailure };

interface Done {
  payerId: string;
  payeeId: string;
  amount: bigint;
  currency: AccountCurrency;
}

/** The fields whose message has no input of its own; they are listed above the action. */
const LOOSE_FIELDS = ['memberA', 'currency', 'occurredAt', 'legs'] as const;

/**
 * Settles the two currencies between two members in one payment. One request for the group, then
 * one preview per valid choice; the legs sent are always the last preview's, never typed.
 */
export function ConsolidationContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.consolidate');
  const tAll = useTranslations();
  const tApp = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');
  const tNotFound = useTranslations('groups.detail.notFound');
  const tDetail = useTranslations('groups.detail');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<ConsolidationChoiceValues>({
    memberA: '',
    memberB: '',
    currency: 'ARS',
  });
  /** Null: the rate was not touched and the stored one applies. */
  const [rateText, setRateText] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [outcome, setOutcome] = useState<{ key: string; result: PreviewOutcome }>();
  const [fields, setFields] = useState<ConsolidationFieldErrors>();
  const [issue, setIssue] = useState<ApiFailure>();
  const [stale, setStale] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [done, setDone] = useState<Done>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const formRef = useFocusInvalid({ fields });

  useEffect(() => {
    let active = true;
    void api.getGroup(groupId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({ kind: 'ready', group: result.data });
        setChoice((current) => ({ ...current, memberA: result.data.selfMemberId }));
      } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else {
        setState(
          result.code === 'NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'failed', error: result.messageKey },
        );
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  const ready = state.kind === 'ready';
  const { memberA, memberB, currency } = choice;
  const validPair = ready && memberA !== '' && memberB !== '' && memberA !== memberB;
  // The key of what is asked: an answer for any other key belongs to an earlier choice.
  const key = `${memberA}|${memberB}|${currency}|${reload}`;

  useEffect(() => {
    if (!validPair) return;
    let active = true;
    void api.getConsolidationPreview(groupId, { memberA, memberB, currency }).then((result) => {
      if (!active) return;
      if (result.ok) setOutcome({ key, result: { kind: 'ready', preview: result.data } });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (result.code === 'NOT_FOUND') setState({ kind: 'not-found' });
      else setOutcome({ key, result: { kind: 'failed', failure: result } });
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, validPair, memberA, memberB, currency, key]);

  if (state.kind === 'not-found') {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={tNotFound('title')}
        description={tNotFound('description')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {tNotFound('back')}
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
  const members = group.members.map((member) => ({
    id: member.id,
    name: member.displayName ?? tDetail('unnamed'),
  }));
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '';
  const sameMember = memberA !== '' && memberA === memberB;
  const current = validPair && outcome?.key === key ? outcome.result : undefined;
  const preview = current?.kind === 'ready' ? current.preview : undefined;

  const typedRate = rateText === null ? undefined : (parseRateInput(rateText, locale) ?? undefined);
  const appliedRate =
    typedRate !== undefined && typedRate >= 1n && typedRate <= RATE_MAX_SCALED
      ? typedRate
      : rateText === null && preview?.rate !== undefined && preview.rate !== null
        ? BigInt(preview.rate)
        : null;
  const rateValue =
    rateText ??
    (preview?.rate !== undefined && preview.rate !== null
      ? formatRateInput(BigInt(preview.rate), locale)
      : '');
  const nothing =
    preview !== undefined && (BigInt(preview.legs.ARS) === 0n || BigInt(preview.legs.USD) === 0n);

  function change(next: ConsolidationChoiceValues) {
    setChoice(next);
    setRateText(null);
    setFields(undefined);
    setIssue(undefined);
    setStale(false);
    setBlocked(false);
    setDone(undefined);
  }

  function retryPreview() {
    setOutcome(undefined);
    setReload((count) => count + 1);
  }

  async function record() {
    if (busyRef.current || preview === undefined) return;
    const now = new Date();
    const built = buildConsolidationRequest(
      preview,
      {
        memberA,
        memberB,
        currency,
        occurredAt: instantToZonedLocal(now, timeZone),
        rate: rateText,
      },
      { memberIds: members.map((member) => member.id), timeZone, locale, now },
    );
    setIssue(undefined);
    setStale(false);
    if (!built.request) {
      setFields(built.fields);
      return;
    }
    setFields(undefined);
    busyRef.current = true;
    setBusy(true);
    const result = await api.createSettlement(groupId, built.request);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setDone({
        payerId: result.data.fromMemberId,
        payeeId: result.data.toMemberId,
        amount: BigInt(result.data.amount),
        currency: result.data.currency,
      });
      setRateText(null);
      retryPreview();
    } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else if (result.code === 'NOT_FOUND') setState({ kind: 'not-found' });
    else if (result.code === 'GROUP_SETTLEMENT_STALE') {
      setDone(undefined);
      setStale(true);
      retryPreview();
    } else {
      if (result.code === 'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE') setBlocked(true);
      setIssue(result);
    }
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void record();
  }

  const looseMessages = fields
    ? LOOSE_FIELDS.map((name) => fields[name]).filter(
        (message): message is ConsolidationFieldMessage => message !== undefined,
      )
    : [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href={`/groups/${encodeURIComponent(groupId)}/balances`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('back')}
          </Link>
        }
      />
      <form ref={formRef} noValidate className="grid gap-4" onSubmit={handleSubmit}>
        <ConsolidationChoiceForm
          members={members}
          values={choice}
          memberBError={sameMember ? 'groups.consolidate.errors.sameMember' : fields?.memberB}
          onChange={change}
        />
        {validPair && current === undefined ? (
          <div role="status" aria-busy="true" className="grid gap-3">
            <span className="sr-only">{tApp('loading')}</span>
            <Skeleton className="h-16" />
          </div>
        ) : null}
        {current?.kind === 'failed' ? (
          <ErrorState
            title={tUi('error.title')}
            description={tErrors(current.failure.messageKey)}
            retryLabel={tApp('retry')}
            onRetry={retryPreview}
          />
        ) : null}
        {preview !== undefined ? (
          <>
            <ConsolidationPreviewView
              preview={preview}
              nameA={nameOf(memberA)}
              nameB={nameOf(memberB)}
              currency={currency}
              rate={appliedRate}
            />
            {nothing ? null : (
              <ConsolidationRateField
                value={rateValue}
                rateType={preview.defaultRateType}
                missingStored={preview.rate === null}
                error={fields?.rate}
                onChange={(value) => {
                  setRateText(value);
                  setFields(undefined);
                }}
              />
            )}
          </>
        ) : null}
        {stale ? (
          <Alert variant="warning">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('stale')}</AlertDescription>
          </Alert>
        ) : null}
        {looseMessages.length > 0 ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>
              {looseMessages.map((message) => (
                <p key={message}>{tAll(message)}</p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}
        {issue ? <GroupIssue failure={issue} /> : null}
        {preview !== undefined && !nothing && !blocked ? (
          <Button type="submit" disabled={busy}>
            {busy ? t('recording') : t('record')}
          </Button>
        ) : null}
      </form>
      {done ? (
        <ConsolidationResult
          payerName={nameOf(done.payerId)}
          payeeName={nameOf(done.payeeId)}
          amount={done.amount}
          currency={done.currency}
        />
      ) : null}
    </div>
  );
}
