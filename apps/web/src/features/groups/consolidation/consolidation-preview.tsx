'use client';

import type { AccountCurrency, ConsolidationPreview as PreviewData } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/format-amount';
import { cashOf } from '../settlements/consolidation-request';

export interface ConsolidationPreviewProps {
  preview: PreviewData;
  nameA: string;
  nameB: string;
  currency: AccountCurrency;
  /** The rate that applies now: the typed one when valid, else the stored one; null when neither. */
  rate: bigint | null;
}

const CURRENCIES: readonly AccountCurrency[] = ['ARS', 'USD'];

/** The legs per direction and the cash that would change hands. Read-only. */
export function ConsolidationPreviewView({
  preview,
  nameA,
  nameB,
  currency,
  rate,
}: ConsolidationPreviewProps) {
  const t = useTranslations('groups.consolidate');
  const language = useLocale() === 'en' ? 'en' : 'es';

  const nothing = BigInt(preview.legs.ARS) === 0n || BigInt(preview.legs.USD) === 0n;
  const cash = !nothing && rate !== null ? cashOf(preview, currency, rate) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('legs.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1">
          {CURRENCIES.map((code) => {
            const leg = BigInt(preview.legs[code]);
            if (leg === 0n) return <li key={code}>{t('legs.none', { currency: code })}</li>;
            const amount = formatMoney(leg < 0n ? -leg : leg, code, language);
            return (
              <li key={code}>
                {leg > 0n
                  ? t('legs.pays', { payer: nameA, payee: nameB, amount })
                  : t('legs.pays', { payer: nameB, payee: nameA, amount })}
              </li>
            );
          })}
        </ul>
        {nothing ? (
          <p className="text-small text-muted-foreground">{t('nothing')}</p>
        ) : cash === null ? (
          <p className="text-small text-muted-foreground">{t('cash.unknown')}</p>
        ) : (
          <div className="grid gap-0.5">
            <span className="text-small text-muted-foreground">{t('cash.label')}</span>
            <span className="font-medium">
              {t('legs.pays', {
                payer: cash.swapped ? nameB : nameA,
                payee: cash.swapped ? nameA : nameB,
                amount: formatMoney(cash.amount, currency, language),
              })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
