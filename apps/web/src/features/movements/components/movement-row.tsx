'use client';

import { exactIntegerStringSchema, formatMoney, type MovementResponse } from '@pesly/shared';
import { ArrowLeftRight, CloudCheck, Pencil, RotateCw, Trash2, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { IconAction } from '@/components/ui/icon-action';
import { ListRow } from '@/components/ui/list-row';
import { CategoryVisual } from '@/features/categories/components/category-visual';
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

export interface MovementRowProps {
  movement: MovementResponse;
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

/** ISO 4217's "no currency" code: it formats the amount with a neutral sign. */
const UNKNOWN_CURRENCY = 'XXX';

/** Only USD-account rows show the frozen rate; ARS rows keep it stored but hide it. */
const USD_CURRENCY = 'USD';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

type FormatterKind = 'time' | 'day' | 'dayKey';

const FORMAT_OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  day: { dateStyle: 'full' },
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

/** The long, localized heading of that day. */
export function formatDay(occurredAt: string, locale: string, timeZone: string): string {
  return dateFormat('day', locale, timeZone).format(new Date(occurredAt));
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
}: MovementRowProps) {
  const t = useTranslations('movements.list');
  const tSync = useTranslations('movements.sync');
  const tErrors = useTranslations('errors');
  const tActions = useTranslations('movements.list.actions');
  const tTypes = useTranslations('movements.types');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const amount = exactIntegerStringSchema.safeParse(movement.amount);
  const moving = movement.type === 'transfer' || movement.type === 'exchange';
  const incoming =
    movement.type === 'exchange' && movement.destinationAmount !== null
      ? exactIntegerStringSchema.safeParse(movement.destinationAmount)
      : undefined;
  const title =
    movement.type === 'transfer'
      ? t('transferTitle')
      : movement.type === 'exchange'
        ? t('exchangeTitle')
        : (categoryName ?? t('unknownCategory'));

  return (
    <li className="grid gap-1 text-card-foreground">
      <ListRow
        leading={
          moving ? (
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-5"
            >
              <ArrowLeftRight />
            </span>
          ) : (
            <CategoryVisual icon={categoryIcon ?? ''} color={categoryColor ?? ''} />
          )
        }
        title={title}
        description={
          <>
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
          </>
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
                    : 'neutral'
                }
                directionLabel={tTypes(movement.type)}
                className="text-body font-semibold"
              />
              {incoming?.success ? (
                <span className="text-body font-semibold whitespace-nowrap tabular-nums text-income">
                  {`+${formatMoney(BigInt(incoming.data), destinationCurrency ?? UNKNOWN_CURRENCY, locale)}`}
                </span>
              ) : null}
            </span>
          ) : (
            // A malformed amount degrades to a dash instead of throwing during render.
            <span className="text-muted-foreground">—</span>
          )
        }
      />
      {syncState === 'synced' ? (
        <div className="flex px-1">
          <span
            role="img"
            aria-label={t('synced')}
            className="text-muted-foreground [&>svg]:size-4"
          >
            <CloudCheck aria-hidden />
          </span>
        </div>
      ) : syncState === 'pending' ? (
        <div className="px-1">
          <Badge variant="warning">{t('pending')}</Badge>
        </div>
      ) : syncState === 'failed' ? (
        <div className="grid gap-1 px-1">
          <div>
            <Badge variant="destructive">{t('failed')}</Badge>
          </div>
          {failure === undefined ? null : (
            <p className="text-small text-destructive">
              {failureMessageKey(failure) === 'deletedElsewhere'
                ? tSync('deletedElsewhere')
                : tErrors(
                    failureMessageKey(failure) as Exclude<
                      ReturnType<typeof failureMessageKey>,
                      'deletedElsewhere'
                    >,
                  )}
            </p>
          )}
        </div>
      ) : null}
      {movement.note === null ? null : (
        <p className="px-1 text-small text-muted-foreground">{movement.note}</p>
      )}
      {movement.tags.length > 0 ? (
        <div role="group" aria-label={t('tags')} className="flex flex-wrap gap-1 px-1">
          {movement.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}
      {movement.rate !== null &&
      (movement.type === 'exchange' || (currency === USD_CURRENCY && !moving)) ? (
        <p className="px-1 text-caption text-muted-foreground">
          {t('rate', {
            rate: formatRate(BigInt(movement.rate), locale, movement.type === 'exchange' ? 4 : 2),
          })}
        </p>
      ) : null}
      {actions === undefined ? null : actions.confirmingDelete ? (
        <div className="grid gap-2 pb-2">
          <p role="status" className="px-1 text-small">
            {tActions('confirmDelete')}
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
        </div>
      ) : (
        <div className="flex justify-end">
          {syncState === 'failed' && actions.onRetry !== undefined ? (
            <IconAction
              label={tActions('retry')}
              subject={title}
              icon={<RotateCw aria-hidden />}
              disabled={actions.pending}
              onClick={actions.onRetry}
            />
          ) : null}
          {syncState === 'failed' && actions.onDiscard !== undefined ? (
            <IconAction
              label={tActions('discard')}
              subject={title}
              icon={<Undo2 aria-hidden />}
              disabled={actions.pending}
              onClick={actions.onDiscard}
            />
          ) : null}
          {/* A failed delete is retried or discarded; editing a deleted movement means nothing. */}
          {failure?.operation === 'delete' ? null : (
            <>
              <Link
                href={`/movements/edit?id=${movement.id}`}
                title={tActions('edit')}
                className={buttonVariants({ size: 'icon', variant: 'ghost' })}
              >
                <Pencil aria-hidden />
                <span className="sr-only">
                  {tActions('edit')} {title}
                </span>
              </Link>
              <IconAction
                label={tActions('delete')}
                subject={title}
                icon={<Trash2 aria-hidden />}
                disabled={actions.pending}
                onClick={actions.onAskDelete}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
