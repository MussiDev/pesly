'use client';

import type { PortfolioResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DonutChart } from '@/components/ui/donut-chart';
import type { Locale } from '@/i18n/routing';
import { formatMoney, formatPercentage } from '@/lib/format-amount';
import { composeByInstrumentType } from '../composition';
import { HoldingRow } from './holding-row';

export interface PortfolioCardProps {
  portfolio: PortfolioResponse;
  language: Locale;
  timeZone: string;
  pending?: boolean;
  onAddHolding?: (portfolioId: string) => void;
  onImportHoldings?: (portfolioId: string) => void;
  onDeletePortfolio?: (portfolioId: string) => void;
  onEditHolding?: (holdingId: string) => void;
  onSetPrice?: (holdingId: string) => void;
  onDeleteHolding?: (holdingId: string) => void;
  onUseAutomaticPrice?: (holdingId: string) => void;
}

export function PortfolioCard({
  portfolio,
  language,
  timeZone,
  pending,
  onAddHolding,
  onImportHoldings,
  onDeletePortfolio,
  onEditHolding,
  onSetPrice,
  onDeleteHolding,
  onUseAutomaticPrice,
}: PortfolioCardProps) {
  const t = useTranslations('investments');
  const compositions = composeByInstrumentType(portfolio.holdings);

  // A newer API may send a type this build does not know; show its raw key.
  const typeLabel = (type: string) =>
    t.has(`instrumentTypes.${type}`) ? t(`instrumentTypes.${type}`) : type;

  return (
    <div className="flex flex-col gap-4">
      <header className="grid gap-1">
        <h2 className="text-small font-normal text-muted-foreground">{portfolio.name}</h2>
        {portfolio.totals.length > 0 && (
          <ul aria-label={t('portfolio.totalsLabel')} className="grid gap-0.5">
            {portfolio.totals.map((total) => (
              <li key={total.currency} className="text-display tabular-nums">
                {formatMoney(BigInt(total.value), total.currency, language)}
              </li>
            ))}
          </ul>
        )}
        {portfolio.holdingsWithoutPrice > 0 && (
          <p className="text-small text-muted-foreground">
            {t('portfolio.holdingsWithoutPrice', { count: portfolio.holdingsWithoutPrice })}
          </p>
        )}
      </header>
      {compositions.length > 0 && (
        <div className="grid gap-4 rounded-card bg-card p-5 shadow-xs sm:grid-cols-2">
          {compositions.map(({ currency, segments }) => (
            <DonutChart
              key={currency}
              label={t('portfolio.compositionLabel', { currency })}
              segments={segments.map((segment) => ({
                key: segment.instrumentType,
                label: typeLabel(segment.instrumentType),
                basisPoints: segment.basisPoints,
              }))}
              formatPercent={(basisPoints) => formatPercentage(BigInt(basisPoints), language)}
              centre={
                <span className="text-caption font-semibold text-muted-foreground">{currency}</span>
              }
            />
          ))}
        </div>
      )}
      {portfolio.holdings.length === 0 ? (
        <p className="rounded-card bg-card p-5 text-small text-muted-foreground shadow-xs">
          {t('portfolio.noHoldings')}
        </p>
      ) : (
        <ul
          aria-label={t('portfolio.holdingsLabel')}
          className="grid divide-y divide-border/70 rounded-card bg-card px-4 py-1 shadow-xs"
        >
          {portfolio.holdings.map((holding) => (
            <HoldingRow
              key={holding.id}
              holding={holding}
              language={language}
              timeZone={timeZone}
              pending={pending}
              onEdit={onEditHolding}
              onSetPrice={onSetPrice}
              onDelete={onDeleteHolding}
              onUseAutomaticPrice={onUseAutomaticPrice}
            />
          ))}
        </ul>
      )}
      {(onAddHolding !== undefined ||
        onImportHoldings !== undefined ||
        onDeletePortfolio !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {onAddHolding !== undefined && (
            <Button
              type="button"
              size="sm"
              aria-label={t('portfolio.addHoldingFor', { name: portfolio.name })}
              data-opener={`add-holding:${portfolio.id}`}
              onClick={() => {
                onAddHolding(portfolio.id);
              }}
            >
              {t('portfolio.addHolding')}
            </Button>
          )}
          {onImportHoldings !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('import.actionFor', { name: portfolio.name })}
              data-opener={`import-holdings:${portfolio.id}`}
              onClick={() => {
                onImportHoldings(portfolio.id);
              }}
            >
              {t('import.action')}
            </Button>
          )}
          {onDeletePortfolio !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('portfolio.deleteFor', { name: portfolio.name })}
              data-opener={`delete-portfolio:${portfolio.id}`}
              onClick={() => {
                onDeletePortfolio(portfolio.id);
              }}
            >
              {t('portfolio.delete')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
