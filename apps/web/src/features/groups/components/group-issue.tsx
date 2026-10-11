'use client';

import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ApiFailure } from '@/lib/api-client';
import { formatMoney } from '@/lib/format-amount';
import { failurePath } from '../group-failure';

const CURRENCIES = ['ARS', 'USD'] as const;

/**
 * Why a group action did not happen. A refusal for a pending balance lists what is owed per
 * currency (signed minor-unit strings, so BigInt and never a float); any other failure shows its
 * own message.
 */
export function GroupIssue({ failure }: { failure: ApiFailure }) {
  const t = useTranslations('groups.detail.balance');
  const tAll = useTranslations();
  const language = useLocale() === 'en' ? 'en' : 'es';

  const { balances } = failure;
  if (failure.code === 'GROUP_MEMBER_HAS_BALANCE' && balances) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>
          <p>{t('intro')}</p>
          <ul className="grid gap-0.5">
            {CURRENCIES.map((currency) => {
              const value = BigInt(balances[currency]);
              if (value === 0n) return null;
              const amount = formatMoney(value < 0n ? -value : value, currency, language);
              return (
                <li key={currency}>{value < 0n ? t('owes', { amount }) : t('owed', { amount })}</li>
              );
            })}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{tAll(failurePath(failure))}</AlertDescription>
    </Alert>
  );
}
