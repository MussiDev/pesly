'use client';

import type { UpcomingItem, UpcomingKind } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Locale } from '@/i18n/routing';
import { formatAmount } from '@/lib/format-amount';
import type { ConfirmFormValues } from '../recurring-request';
import { ConfirmOccurrenceForm, type ConfirmFormErrors } from './confirm-occurrence-form';
import { OccurrenceRow } from './occurrence-row';
import type { RecurringLookups } from './recurring-lookups';

const KIND_ORDER: Record<UpcomingKind, number> = { overdue: 0, pending: 1, scheduled: 2 };

interface UpcomingListProps {
  items: readonly UpcomingItem[];
  lookups: RecurringLookups;
  /** The occurrence whose confirm form is open. */
  confirmingId: string | undefined;
  pending: boolean;
  confirmErrors: ConfirmFormErrors;
  /** A full catalog path shown above the list, for example the mapped 409 message. */
  notice: string | undefined;
  onConfirmOpen: (item: UpcomingItem) => void;
  onConfirmCancel: () => void;
  onConfirmSubmit: (item: UpcomingItem, values: ConfirmFormValues) => void;
  onSkip: (item: UpcomingItem) => void;
}

/** Overdue first, then pending, then what is scheduled; each group by due date (FR-08). */
export function UpcomingList({
  items,
  lookups,
  confirmingId,
  pending,
  confirmErrors,
  notice,
  onConfirmOpen,
  onConfirmCancel,
  onConfirmSubmit,
  onSkip,
}: UpcomingListProps) {
  const t = useTranslations('recurring');
  const tAll = useTranslations();
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
        (a.item.dueDate < b.item.dueDate ? -1 : a.item.dueDate > b.item.dueDate ? 1 : 0) ||
        a.index - b.index,
    )
    .map(({ item }) => item);

  return (
    <div className="grid gap-3">
      {notice ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(notice)}</AlertDescription>
        </Alert>
      ) : null}
      {ordered.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('listNoUpcoming')}</p>
      ) : (
        <ul
          className="divide-y rounded-xl border bg-card px-3"
          aria-label={t('list.upcomingLabel')}
        >
          {ordered.map((item) => {
            const open = item.occurrenceId !== null && item.occurrenceId === confirmingId;
            return (
              <li key={`${item.paymentId}-${item.dueDate}-${item.kind}`} aria-label={item.name}>
                <OccurrenceRow
                  item={item}
                  lookups={lookups}
                  pending={pending}
                  onConfirm={onConfirmOpen}
                  onSkip={onSkip}
                />
                {open ? (
                  <div className="pb-3">
                    <ConfirmOccurrenceForm
                      name={item.name}
                      defaultAmount={formatAmount(BigInt(item.amount), locale)}
                      defaultDate={item.dueDate}
                      pending={pending}
                      errors={confirmErrors}
                      onSubmit={(values) => {
                        onConfirmSubmit(item, values);
                      }}
                      onCancel={onConfirmCancel}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
