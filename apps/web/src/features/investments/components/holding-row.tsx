'use client';

import type { HoldingResponse } from '@pesly/shared';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import type { Locale } from '@/i18n/routing';
import { formatDateTime, formatMoney, formatPercentage, formatQuantity } from '@/lib/format-amount';
import { cn } from '@/lib/utils';

export interface HoldingRowProps {
  holding: HoldingResponse;
  language: Locale;
  timeZone: string;
  onEdit?: (holdingId: string) => void;
  onSetPrice?: (holdingId: string) => void;
  onDelete?: (holdingId: string) => void;
}

// The tone only reinforces the label and sign already in the text ("Gain +…", "Loss -…").
const GAIN_TONE = { gain: 'text-income', loss: 'text-destructive', flat: 'text-foreground' };

function signed(text: string, amount: bigint): string {
  return amount > 0n ? `+${text}` : text;
}

export function HoldingRow({
  holding,
  language,
  timeZone,
  onEdit,
  onSetPrice,
  onDelete,
}: HoldingRowProps) {
  const t = useTranslations('investments');
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  // A newer API may send a type or source this build does not know; show its raw key.
  const typeLabel = t.has(`instrumentTypes.${holding.instrumentType}`)
    ? t(`instrumentTypes.${holding.instrumentType}`)
    : holding.instrumentType;
  const sourceLabel =
    holding.priceSource === null
      ? null
      : t.has(`priceSources.${holding.priceSource}`)
        ? t(`priceSources.${holding.priceSource}`)
        : holding.priceSource;

  const gainAmount = holding.gain === null ? 0n : BigInt(holding.gain.amount);
  const isLoss = gainAmount < 0n;
  const gainTone = isLoss ? 'loss' : gainAmount > 0n ? 'gain' : 'flat';
  const pricedAt =
    holding.pricedAt === null ? null : formatDateTime(holding.pricedAt, timeZone, language);
  const currency = holding.valuationCurrency;

  return (
    <li className="flex flex-col gap-1 py-1">
      <ListRow
        className="items-start"
        title={holding.ticker}
        description={
          <>
            <span className="block truncate">{holding.instrumentName}</span>
            <span className="block">{typeLabel}</span>
            <span className="block">
              {t('holding.quantity', {
                quantity: formatQuantity(BigInt(holding.quantity), language),
              })}
            </span>
          </>
        }
        trailing={
          <div className="flex flex-col items-end text-right tabular-nums">
            {holding.value === null ? (
              <span className="text-small text-muted-foreground">{t('holding.priceNeeded')}</span>
            ) : (
              <span className="text-body font-medium">
                {formatMoney(BigInt(holding.value), currency, language)}
              </span>
            )}
            {holding.gain !== null && (
              <span className={cn('text-caption', GAIN_TONE[gainTone])}>
                {t(isLoss ? 'holding.loss' : 'holding.gain', {
                  amount: signed(formatMoney(gainAmount, currency, language), gainAmount),
                  percent: signed(
                    formatPercentage(BigInt(holding.gain.basisPoints), language),
                    gainAmount,
                  ),
                })}
              </span>
            )}
            {holding.priceStale && pricedAt !== null && (
              <span className="text-caption text-muted-foreground">
                {t('holding.stalePrice', { date: pricedAt })}
              </span>
            )}
          </div>
        }
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        <span className="sr-only">
          {open
            ? t('holding.hideDetailsFor', { ticker: holding.ticker })
            : t('holding.showDetailsFor', { ticker: holding.ticker })}
        </span>
        <span aria-hidden>{open ? t('holding.hideDetails') : t('holding.showDetails')}</span>
      </Button>
      {open && (
        <div
          id={detailsId}
          className="flex flex-col gap-3 rounded-md border bg-surface p-3 text-small"
        >
          {holding.unitPrice === null ? (
            <p className="text-muted-foreground">{t('holding.noPrice')}</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('holding.unitPrice')}</dt>
              <dd>{formatMoney(BigInt(holding.unitPrice), currency, language)}</dd>
              {sourceLabel !== null && (
                <>
                  <dt className="text-muted-foreground">{t('holding.priceSource')}</dt>
                  <dd>{sourceLabel}</dd>
                </>
              )}
              {pricedAt !== null && (
                <>
                  <dt className="text-muted-foreground">{t('holding.pricedAt')}</dt>
                  <dd>{pricedAt}</dd>
                </>
              )}
            </dl>
          )}
          {(onEdit !== undefined || onSetPrice !== undefined || onDelete !== undefined) && (
            <div className="flex flex-wrap gap-2">
              {onEdit !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.editFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onEdit(holding.id);
                  }}
                >
                  {t('holding.edit')}
                </Button>
              )}
              {onSetPrice !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.setPriceFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onSetPrice(holding.id);
                  }}
                >
                  {t('holding.setPrice')}
                </Button>
              )}
              {onDelete !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.deleteFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onDelete(holding.id);
                  }}
                >
                  {t('holding.delete')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
