import type { InstallmentSchedule } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { formatCalendarDate, formatPeriod } from '../format-dates';

interface InstallmentSchedulePreviewProps {
  schedule: InstallmentSchedule | null;
  currency: 'ARS' | 'USD';
}

/** The payments a purchase would get, before it is saved (FR-02, FR-05 to FR-07, FR-10). */
export function InstallmentSchedulePreview({
  schedule,
  currency,
}: InstallmentSchedulePreviewProps) {
  const t = useTranslations('creditCards.installments.preview');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  if (schedule === null) return null;

  const cell = 'px-3 py-2 text-start';
  return (
    <section className="grid gap-3" data-slot="installment-schedule-preview">
      <h3 className="text-body font-medium">{t('title')}</h3>
      <div
        className="overflow-x-auto rounded-card bg-card"
        role="region"
        aria-label={t('title')}
        tabIndex={0}
      >
        <table className="w-full text-small">
          <caption className="px-3 pt-3 text-start text-muted-foreground">
            {schedule.kind === 'expense' ? t('expenseLabel') : t('installmentsLabel')}
          </caption>
          <thead>
            <tr className="border-b border-border/70 text-muted-foreground">
              <th scope="col" className={cell}>
                {t('columns.number')}
              </th>
              <th scope="col" className={cell}>
                {t('columns.amount')}
              </th>
              <th scope="col" className={cell}>
                {t('columns.statement')}
              </th>
              <th scope="col" className={cell}>
                {t('columns.closes')}
              </th>
              <th scope="col" className={cell}>
                {t('columns.due')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {schedule.rows.map((row) => (
              <tr key={row.number}>
                <td className={`${cell} tabular-nums`}>{row.number}</td>
                <td className={`${cell} tabular-nums`}>
                  {formatMoney(row.amount, currency, locale)}
                </td>
                <td className={cell}>
                  {formatPeriod(row.period, locale)}
                  {row.closed ? (
                    <>
                      {' '}
                      <Badge variant="destructive">{t('closedBadge')}</Badge>
                    </>
                  ) : null}
                </td>
                <td className={cell}>{formatCalendarDate(row.closingDate, locale)}</td>
                <td className={cell}>{formatCalendarDate(row.dueDate, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-small text-muted-foreground">
        {t('closingDayNote', { date: formatCalendarDate(schedule.firstClosingDate, locale) })}
      </p>
      {schedule.firstClosed ? (
        <Alert variant="destructive">
          <AlertDescription>{t('closedWarning')}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
