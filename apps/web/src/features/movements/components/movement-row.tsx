'use client';

import { exactIntegerStringSchema, formatMoney, type MovementResponse } from '@pesly/shared';
import { CloudCheck, Pencil, RotateCw, Tag, Trash2, Undo2, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { MovementAvatar } from './movement-avatar';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatRate } from '../format-rate';
import { failureMessageKey } from '../sync-failure';
import type { SyncFailure, SyncState } from '../sync-overlay';

/** What a row offers to do with its movement; absent, the row only shows it. */
export interface MovementRowActions {
  /** A delete (or any other action) is in flight: the buttons wait. */
  pending: boolean;
  /** The inline confirmation of a delete is open for this row. */
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** Offered on a failed change: send it again. */
  onRetry?: () => void;
  /** Offered on a failed change: drop it from the device. */
  onDiscard?: () => void;
}

/** What the row says about sending the movement to a group: the action, or where it already is. */
export type MovementGroupAction =
  | { kind: 'send' }
  /** `groupName` is `undefined` when the group is not among the person's groups. */
  | { kind: 'linked'; groupName: string | undefined };

export interface MovementRowProps {
  movement: MovementResponse;
  groupAction?: MovementGroupAction | undefined;
  /** The row the person came to find (a link from the home screen): marked, not by color alone. */
  highlighted?: boolean;
  /** `undefined` when the account is not in the loaded sets: a neutral placeholder shows. */
  accountName: string | undefined;
  currency: string | undefined;
  categoryName: string | undefined;
  /** The category's own icon and color keys; unknown or missing ones render the neutral fallback. */
  categoryIcon?: string;
  categoryColor?: string;
  /** Transfers and exchanges only; `undefined` when the destination is not in the loaded sets. */
  destinationAccountName: string | undefined;
  destinationCurrency: string | undefined;
  timeZone: string;
  actions?: MovementRowActions;
  /** Where the movement stands against the server; absent, no marker shows. */
  syncState?: SyncState;
  /** Why the server refused its change, when `syncState` is `failed`. */
  failure?: SyncFailure;
}

/** A visible action word whose accessible name also names the movement: "Delete Food". */
function ActionLabel({ action, subject }: { action: string; subject: string }) {
  return (
    <>
      <span aria-hidden="true">{action}</span>
      <span className="sr-only">{`${action} ${subject}`}</span>
    </>
  );
}

/** ISO 4217's "no currency" code: it formats the amount with a neutral sign. */
const UNKNOWN_CURRENCY = 'XXX';

/** Only USD-account rows show the frozen rate; ARS rows keep it stored but hide it. */
const USD_CURRENCY = 'USD';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

type FormatterKind = 'time' | 'day' | 'dayOfOtherYear' | 'dayKey';

const FORMAT_OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  // The year only when it is not the current one: a long heading wraps on a phone.
  day: { weekday: 'long', day: 'numeric', month: 'long' },
  dayOfOtherYear: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  // A sortable, locale-free `YYYY-MM-DD`: what groups movements into days.
  dayKey: { year: 'numeric', month: '2-digit', day: '2-digit' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per kind, locale and zone, shared by every row; an invalid zone uses the default. */
function dateFormat(kind: FormatterKind, locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${kind}|${locale}|${timeZone}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  const options = FORMAT_OPTIONS[kind];
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch (error) {
    // Only a RangeError means a bad zone; anything else is a real failure.
    if (!(error instanceof RangeError)) throw error;
    created = new Intl.DateTimeFormat(locale, { ...options, timeZone: DEFAULT_TIME_ZONE });
  }
  formatters.set(key, created);
  return created;
}

/** The calendar day of an instant in the user's zone, as `YYYY-MM-DD` (the en-CA layout). */
export function dayKey(occurredAt: string, timeZone: string): string {
  return dateFormat('dayKey', 'en-CA', timeZone).format(new Date(occurredAt));
}

/** The localized heading of that day; `now` decides whether the year is worth showing. */
export function formatDay(
  occurredAt: string,
  locale: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const sameYear =
    dayKey(occurredAt, timeZone).slice(0, 4) === dayKey(now.toISOString(), timeZone).slice(0, 4);
  return dateFormat(sameYear ? 'day' : 'dayOfOtherYear', locale, timeZone).format(
    new Date(occurredAt),
  );
}

export function MovementRow({
  movement,
  accountName,
  currency,
  categoryName,
  categoryIcon,
  categoryColor,
  destinationAccountName,
  destinationCurrency,
  timeZone,
  actions,
  syncState,
  failure,
  groupAction,
  highlighted = false,
}: MovementRowProps) {
  const t = useTranslations('movements.list');
  const tSync = useTranslations('movements.sync');
  const tErrors = useTranslations('errors');
  const tActions = useTranslations('movements.list.actions');
  const tTypes = useTranslations('movements.types');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const amount = exactIntegerStringSchema.safeParse(movement.amount);
  const moving = movement.type === 'transfer' || movement.type === 'exchange';
  const adjustment = movement.type === 'adjustment';
  const incoming =
    movement.type === 'exchange' && movement.destinationAmount !== null
      ? exactIntegerStringSchema.safeParse(movement.destinationAmount)
      : undefined;
  const title =
    movement.type === 'adjustment'
      ? tTypes('adjustment')
      : movement.type === 'transfer'
        ? t('transferTitle')
        : movement.type === 'exchange'
          ? t('exchangeTitle')
          : (categoryName ?? t('unknownCategory'));

  const marker =
    syncState === 'pending' ? (
      <Badge variant="warning">{t('pending')}</Badge>
    ) : syncState === 'failed' ? (
      <Badge variant="destructive">{t('failed')}</Badge>
    ) : null;
  const failureText =
    syncState === 'failed' && failure !== undefined ? (
      <p className="px-1 text-small text-destructive">
        {failureMessageKey(failure) === 'deletedElsewhere'
          ? tSync('deletedElsewhere')
          : tErrors(
              failureMessageKey(failure) as Exclude<
                ReturnType<typeof failureMessageKey>,
                'deletedElsewhere'
              >,
            )}
      </p>
    ) : null;
  const showRate =
    movement.rate !== null &&
    (movement.type === 'exchange' || (currency === USD_CURRENCY && !moving));
  const linkedGroup =
    groupAction?.kind === 'linked' && failure?.operation !== 'delete'
      ? groupAction.groupName === undefined
        ? t('inGroupUnknown')
        : t('inGroup', { name: groupAction.groupName })
      : undefined;
  const offerSend =
    actions !== undefined &&
    !actions.confirmingDelete &&
    groupAction?.kind === 'send' &&
    !adjustment &&
    failure?.operation !== 'delete';
  // A failed change keeps its retry and discard in view; anything else opens with a tap.
  const open = expanded || actions?.confirmingDelete === true;

  const summary = (
    <ListRow
      wrapDescription
      className="py-2.5"
      leading={
        <MovementAvatar
          type={movement.type}
          note={movement.note}
          categoryIcon={categoryIcon}
          categoryColor={categoryColor}
        />
      }
      title={title}
      description={
        <span className="grid gap-1">
          <span>
            <span>{accountName ?? t('unknownAccount')}</span>
            {moving ? (
              <>
                <span aria-hidden="true"> → </span>
                <span>{destinationAccountName ?? t('unknownAccount')}</span>
              </>
            ) : null}
            <span aria-hidden="true"> · </span>
            <time dateTime={movement.occurredAt}>
              {dateFormat('time', locale, timeZone).format(new Date(movement.occurredAt))}
            </time>
            {syncState === 'synced' ? (
              // Small and inline: every settled row carries it, so it must not cost a line.
              <span
                role="img"
                aria-label={t('synced')}
                className="ml-1.5 inline-flex align-[-2px] [&>svg]:size-3.5"
              >
                <CloudCheck aria-hidden />
              </span>
            ) : null}
          </span>
          {movement.note === null ? null : (
            <span className="line-clamp-1 text-foreground/80">{movement.note}</span>
          )}
        </span>
      }
      trailing={
        amount.success ? (
          <span className="grid justify-items-end">
            <Amount
              // A transfer or exchange takes money out of the source: it keeps its own minus sign.
              value={moving ? -BigInt(amount.data) : BigInt(amount.data)}
              // The neutral code applies only when the account is not among the loaded ones.
              currency={currency ?? UNKNOWN_CURRENCY}
              locale={locale}
              kind={
                movement.type === 'income' || movement.type === 'expense'
                  ? movement.type
                  : adjustment
                    ? // The stored sign is the direction: money added to or taken off the balance.
                      BigInt(amount.data) < 0n
                      ? 'expense'
                      : 'income'
                    : 'neutral'
              }
              directionLabel={tTypes(movement.type)}
              className="text-small font-bold"
            />
            {incoming?.success ? (
              <span className="text-small font-semibold whitespace-nowrap tabular-nums text-income">
                {`+${formatMoney(BigInt(incoming.data), destinationCurrency ?? UNKNOWN_CURRENCY, locale)}`}
              </span>
            ) : null}
            {offerSend ? (
              // In view, not behind the row toggle: sending stays within three taps (NFR-08).
              <Link
                href={`/movements/send?id=${movement.id}`}
                title={tActions('sendToGroup')}
                className={buttonVariants({
                  size: 'icon',
                  variant: 'ghost',
                  className: 'relative z-10 -my-1.5 -mr-2.5 text-muted-foreground',
                })}
              >
                <Users aria-hidden />
                <span className="sr-only">{`${tActions('sendToGroup')} ${title}`}</span>
              </Link>
            ) : null}
          </span>
        ) : (
          // A malformed amount degrades to a dash instead of throwing during render.
          <span className="text-muted-foreground">—</span>
        )
      }
    />
  );

  // Under the whole row, not the title column: the amount leaves the title too little width.
  const meta =
    movement.tags.length > 0 || linkedGroup !== undefined || marker !== null ? (
      <div className="-mt-1 flex flex-wrap items-center gap-1 pb-2.5 pl-14">
        {marker}
        {linkedGroup === undefined ? null : (
          <Badge variant="info">
            <Users aria-hidden />
            {linkedGroup}
          </Badge>
        )}
        {movement.tags.length > 0 ? (
          <span role="group" aria-label={t('tags')} className="contents">
            {movement.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                <Tag aria-hidden />
                {tag}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
    ) : null;

  const rate = showRate ? (
    <p className="px-1 text-caption text-muted-foreground">
      {t('rate', {
        rate: formatRate(
          BigInt(movement.rate ?? '0'),
          locale,
          movement.type === 'exchange' ? 4 : 2,
        ),
      })}
    </p>
  ) : null;

  return (
    <li
      id={`movement-row-${movement.id}`}
      className={
        highlighted
          ? 'grid rounded-card text-card-foreground ring-2 ring-ring outline-none'
          : 'grid text-card-foreground'
      }
      {...(highlighted ? { 'aria-current': 'true' as const, tabIndex: -1 } : {})}
    >
      {highlighted ? <span className="sr-only">{t('highlighted')}</span> : null}
      {actions === undefined ? (
        <>
          {summary}
          {meta}
          {rate}
        </>
      ) : (
        <>
          <div className="relative">
            {summary}
            {meta}
            {/* Over the row, not around it: the row is block content a button cannot hold. */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              className="absolute inset-0 cursor-pointer rounded-xl transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              onClick={() => {
                if (actions.confirmingDelete) actions.onCancelDelete();
                setExpanded((value) => !value);
              }}
            >
              <span className="sr-only">{t('toggleActions', { title })}</span>
            </button>
          </div>
          {failureText}
          {syncState === 'failed' &&
          (actions.onRetry !== undefined || actions.onDiscard !== undefined) ? (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {actions.onRetry === undefined ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.pending}
                  onClick={actions.onRetry}
                >
                  <RotateCw aria-hidden />
                  <ActionLabel action={tActions('retry')} subject={title} />
                </Button>
              )}
              {actions.onDiscard === undefined ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.pending}
                  onClick={actions.onDiscard}
                >
                  <Undo2 aria-hidden />
                  <ActionLabel action={tActions('discard')} subject={title} />
                </Button>
              )}
            </div>
          ) : null}
          <div id={panelId} hidden={!open} className="grid gap-2 pb-3">
            {rate}
            {actions.confirmingDelete ? (
              <>
                <p role="status" className="px-1 text-small">
                  {adjustment ? tActions('confirmDeleteAdjustment') : tActions('confirmDelete')}
                </p>
                <div className="flex gap-2 px-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={actions.pending}
                    onClick={actions.onConfirmDelete}
                  >
                    {tActions('confirmDeleteYes')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actions.pending}
                    onClick={actions.onCancelDelete}
                  >
                    {tActions('cancel')}
                  </Button>
                </div>
              </>
            ) : // A failed delete is retried or discarded; editing a deleted movement means nothing.
            failure?.operation === 'delete' ? null : (
              <div className="flex flex-wrap gap-2 px-1">
                {/* An adjustment is changed by setting the balance again, never edited. */}
                {adjustment ? null : (
                  <Link
                    href={`/movements/edit?id=${movement.id}`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    <Pencil aria-hidden />
                    <ActionLabel action={tActions('edit')} subject={title} />
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={actions.pending}
                  onClick={actions.onAskDelete}
                >
                  <Trash2 aria-hidden />
                  <ActionLabel action={tActions('delete')} subject={title} />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </li>
  );
}
