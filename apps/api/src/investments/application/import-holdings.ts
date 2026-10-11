import { ImportPlanError, planHoldingsImport } from '@pesly/shared';
import type { InstrumentType, ValuationCurrency } from '@pesly/shared';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { InvestmentRuleViolation } from '../domain/errors';
import type { Clock, InvestmentsUnitOfWork, MarketPriceReader } from './ports';
import { buildPortfolioView, lookupMarketPrices, type PortfolioView } from './portfolio-view';

/** One holding of the file, already validated and converted at the HTTP boundary. */
export interface ImportHoldingRow {
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  valuationCurrency: ValuationCurrency;
  /** Scaled by 10^8. */
  quantity: bigint;
  /** Minor units; null when the file carries no cost. */
  totalCost: bigint | null;
  unitPrice: bigint;
  pricedAt: Date;
}

export interface ImportHoldingsResult {
  created: number;
  updated: number;
  removed: number;
  portfolio: PortfolioView;
}

/**
 * DISC-001-07c FR-03: replaces the holdings of a portfolio with the file's. The whole replace is
 * one transaction under the portfolio lock, so a concurrent add or a second import cannot
 * interleave and a failure leaves the portfolio as it was.
 */
export class ImportHoldings {
  constructor(
    private readonly unitOfWork: InvestmentsUnitOfWork,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: AccessScope<'write'>,
    portfolioId: string,
    rows: readonly ImportHoldingRow[],
  ): Promise<ImportHoldingsResult> {
    const applied = await this.unitOfWork.run(async ({ portfolios, holdings }) => {
      const portfolio = notFoundUnlessAllowed(await portfolios.lockById(scope, portfolioId));
      const current = await holdings.listByPortfolio(scope, portfolio.id);
      const plan = planOrReject(current, rows);

      for (const holding of plan.remove) {
        if (!(await holdings.delete(scope, holding.id))) throw new ResourceNotFound();
      }
      for (const { current: existing, incoming } of plan.update) {
        notFoundUnlessAllowed(
          await holdings.update(scope, existing.id, {
            quantity: incoming.quantity,
            totalCost: incoming.totalCost,
            valuationCurrency: incoming.valuationCurrency,
            price: priceOf(incoming),
          }),
        );
      }
      for (const incoming of plan.create) {
        const inserted = notFoundUnlessAllowed(
          await holdings.insert(scope, portfolio.id, {
            ticker: incoming.ticker,
            instrumentName: incoming.instrumentName,
            instrumentType: incoming.instrumentType,
            quantity: incoming.quantity,
            valuationCurrency: incoming.valuationCurrency,
            totalCost: incoming.totalCost,
          }),
        );
        notFoundUnlessAllowed(
          await holdings.setPrice(
            scope,
            inserted.id,
            incoming.unitPrice,
            'import',
            incoming.pricedAt,
          ),
        );
      }

      return {
        portfolio,
        stored: await holdings.listByPortfolio(scope, portfolio.id),
        created: plan.create.length,
        updated: plan.update.length,
        removed: plan.remove.length,
      };
    });

    const market = await lookupMarketPrices(this.marketPrices, applied.stored);
    return {
      created: applied.created,
      updated: applied.updated,
      removed: applied.removed,
      portfolio: buildPortfolioView(applied.portfolio, applied.stored, this.clock.now(), market),
    };
  }
}

function priceOf(row: ImportHoldingRow) {
  return { unitPrice: row.unitPrice, source: 'import' as const, pricedAt: row.pricedAt };
}

function planOrReject<Current extends { id: string; ticker: string; instrumentType: string }>(
  current: readonly Current[],
  rows: readonly ImportHoldingRow[],
) {
  try {
    return planHoldingsImport(current, rows);
  } catch (error) {
    // The plan error names only a code, so nothing from the file reaches the response or the log.
    if (error instanceof ImportPlanError) throw new InvestmentRuleViolation('holdings');
    throw error;
  }
}
