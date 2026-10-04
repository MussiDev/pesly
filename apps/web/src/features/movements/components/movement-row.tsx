'use client';

import { exactIntegerStringSchema, formatMoney, type MovementResponse } from '@pesly/shared';
import { ArrowLeftRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list-row';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import type { Locale } from '@/i18n/routing';
import { formatRate } from '../format-rate';

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
}: MovementRowProps) {
  const t = useTranslations('movements.list');
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
    </li>
  );
}
