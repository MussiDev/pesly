'use client';

import type { PortfolioResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { HoldingRow } from './holding-row';

export interface PortfolioCardProps {
  portfolio: PortfolioResponse;
  language: Locale;
  timeZone: string;
  onAddHolding?: (portfolioId: string) => void;
  onDeletePortfolio?: (portfolioId: string) => void;
  onEditHolding?: (holdingId: string) => void;
  onSetPrice?: (holdingId: string) => void;
  onDeleteHolding?: (holdingId: string) => void;
}

export function PortfolioCard({
  portfolio,
  language,
  timeZone,
  onAddHolding,
  onDeletePortfolio,
  onEditHolding,
  onSetPrice,
  onDeleteHolding,
}: PortfolioCardProps) {
  const t = useTranslations('investments');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{portfolio.name}</CardTitle>
        {portfolio.totals.length > 0 && (
          <ul
            aria-label={t('portfolio.totalsLabel')}
            className="flex flex-wrap gap-x-4 gap-y-1 pt-1"
          >
            {portfolio.totals.map((total) => (
              <li key={total.currency} className="text-heading tabular-nums">
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
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {portfolio.holdings.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('portfolio.noHoldings')}</p>
        ) : (
          <ul aria-label={t('portfolio.holdingsLabel')} className="grid divide-y">
            {portfolio.holdings.map((holding) => (
              <HoldingRow
                key={holding.id}
                holding={holding}
                language={language}
                timeZone={timeZone}
                onEdit={onEditHolding}
                onSetPrice={onSetPrice}
                onDelete={onDeleteHolding}
              />
            ))}
          </ul>
        )}
        {(onAddHolding !== undefined || onDeletePortfolio !== undefined) && (
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
      </CardContent>
    </Card>
  );
}
