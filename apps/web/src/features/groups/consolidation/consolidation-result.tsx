'use client';

import type { AccountCurrency } from '@pesly/shared';
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatMoney } from '@/lib/format-amount';

export interface ConsolidationResultProps {
  payerName: string;
  payeeName: string;
  amount: bigint;
  currency: AccountCurrency;
}

/** The one confirmation of a recorded consolidation: who paid whom, in the chosen currency. */
export function ConsolidationResult({
  payerName,
  payeeName,
  amount,
  currency,
}: ConsolidationResultProps) {
  const t = useTranslations('groups.consolidate.done');
  const language = useLocale() === 'en' ? 'en' : 'es';

  return (
    <Alert variant="success">
      <CircleCheck aria-hidden />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        {t('summary', {
          payer: payerName,
          payee: payeeName,
          amount: formatMoney(amount, currency, language),
        })}
      </AlertDescription>
    </Alert>
  );
}
