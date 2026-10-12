import { useTranslations } from 'next-intl';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { formatMoney } from '@/lib/format-amount';
import type { Locale } from '@/i18n/routing';
import type { Currency, SeriesPointView } from '../dashboard-view';

/** The same series as the chart, as a native table for assistive technology. */
export function NetWorthPointsList({
  locale,
  currency,
  points,
}: {
  locale: Locale;
  currency: Currency;
  points: readonly SeriesPointView[];
}) {
  const t = useTranslations('dashboard');
  return (
    // The wrapper is what is clipped: a table ignores width and overflow, so a bare `sr-only`
    // table stays as wide as its text and scrolls the page sideways.
    <div className="sr-only">
      <table>
        <caption>{t('chart.pointsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('chart.dateHeading')}</th>
            <th scope="col">{t('chart.valueHeading')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatCalendarDate(point.date, locale)}</th>
              <td>
                {point.total === null ? (
                  <>
                    <span>{formatMoney(point.ars, 'ARS', locale)}</span>{' '}
                    <span>{formatMoney(point.usd, 'USD', locale)}</span>{' '}
                    <span>{t('netWorth.conversionUnavailable')}</span>
                  </>
                ) : (
                  formatMoney(point.total, currency, locale)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
