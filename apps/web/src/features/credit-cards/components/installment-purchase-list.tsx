'use client';

import type { InstallmentPurchaseResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { formatCalendarDate } from '../format-dates';

interface InstallmentPurchaseListProps {
  purchases: readonly InstallmentPurchaseResponse[];
  /** Pending debt per currency in minor units, as the API sends it. */
  pendingDebt: { ARS: string; USD: string };
  confirmingId: string | undefined;
  pending: boolean;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
}

/** The card's pending debt and its active installment purchases, with a confirmed delete (FR-07, FR-08). */
export function InstallmentPurchaseList({
  purchases,
  pendingDebt,
  confirmingId,
  pending,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: InstallmentPurchaseListProps) {
  const t = useTranslations('creditCards.installments');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const debt = formatMoney(BigInt(pendingDebt.ARS), 'ARS', locale);
  const debtUsd =
    BigInt(pendingDebt.USD) === 0n ? null : formatMoney(BigInt(pendingDebt.USD), 'USD', locale);

  return (
    <div className="grid gap-3">
      <p className="text-body" aria-label={t('pendingDebtLabel', { amount: debt })}>
        <span>{t('pendingDebt')}</span> <span className="tabular-nums font-medium">{debt}</span>
      </p>
      {debtUsd === null ? null : (
        <p className="text-body" aria-label={t('pendingDebtLabel', { amount: debtUsd })}>
          <span>{t('pendingDebt')}</span>{' '}
          <span className="tabular-nums font-medium">{debtUsd}</span>
        </p>
      )}
      {purchases.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card px-3">
          {purchases.map((purchase) => {
            const date = formatCalendarDate(purchase.purchasedOn, locale);
            const title = purchase.note ?? t('purchaseOn', { date });
            const open = purchase.installments.filter((i) => i.status === 'open').length;
            return (
              <li key={purchase.id} aria-label={title}>
                <ListRow
                  title={title}
                  description={
                    <>
                      <span>
                        {t('summary', {
                          count: purchase.installmentCount,
                          total: formatMoney(BigInt(purchase.amount), purchase.currency, locale),
                        })}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{t('openCount', { count: open })}</span>
                    </>
                  }
                  trailing={
                    confirmingId === purchase.id ? (
                      <span className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pending}
                          onClick={() => {
                            onDelete(purchase.id);
                          }}
                        >
                          {t('confirmDelete')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={onCancelDelete}>
                          {t('cancel')}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onAskDelete(purchase.id);
                        }}
                      >
                        {t('delete')}
                      </Button>
                    )
                  }
                />
                {confirmingId === purchase.id ? (
                  <p className="pb-3 text-sm text-muted-foreground">{t('deleteHint')}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
