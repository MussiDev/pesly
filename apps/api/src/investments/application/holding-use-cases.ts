import type { InstrumentType, ValuationCurrency } from '@pesly/shared';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import {
  applyHoldingEdit,
  assertCryptoInUsd,
  mergeHoldings,
  type HoldingEditPatch,
} from '../domain/holding';
import { InvestmentRuleViolation } from '../domain/errors';
import type { Clock, HoldingRepository, InvestmentsUnitOfWork, MarketPriceReader } from './ports';
import { buildHoldingView, lookupMarketPrices, type HoldingView } from './portfolio-view';

export interface AddHoldingInput {
  portfolioId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: bigint;
  valuationCurrency: ValuationCurrency;
  totalCost?: bigint | null;
}

export interface AddHoldingResult {
  holding: HoldingView;
  merged: boolean;
}

export class AddHolding {
  constructor(
    private readonly unitOfWork: InvestmentsUnitOfWork,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope<'write'>, input: AddHoldingInput): Promise<AddHoldingResult> {
    const totalCost = input.totalCost ?? null;
    const { holding, merged } = await this.unitOfWork.run(async ({ portfolios, holdings }) => {
      // The portfolio lock serializes concurrent adds of one ticker.
      const portfolio = notFoundUnlessAllowed(await portfolios.lockById(scope, input.portfolioId));
      const existing = await holdings.findByTicker(scope, portfolio.id, input.ticker);

      if (existing === null) {
        assertCryptoInUsd(input.instrumentType, input.valuationCurrency);
        const inserted = notFoundUnlessAllowed(
          await holdings.insert(scope, portfolio.id, {
            ticker: input.ticker,
            instrumentName: input.instrumentName,
            instrumentType: input.instrumentType,
            quantity: input.quantity,
            valuationCurrency: input.valuationCurrency,
            totalCost,
          }),
        );
        return { holding: inserted, merged: false };
      }

      const resolved = mergeHoldings(existing, {
        quantity: input.quantity,
        valuationCurrency: input.valuationCurrency,
        totalCost,
      });
      const updated = notFoundUnlessAllowed(
        await holdings.update(scope, existing.id, {
          quantity: resolved.quantity,
          totalCost: resolved.totalCost,
          valuationCurrency: resolved.valuationCurrency,
          price: resolved.price,
        }),
      );
      return { holding: updated, merged: true };
    });
    const market = await lookupMarketPrices(this.marketPrices, [holding]);
    return { holding: buildHoldingView(holding, this.clock.now(), market), merged };
  }
}

export class GetHolding {
  constructor(
    private readonly holdings: HoldingRepository,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope, holdingId: string): Promise<HoldingView> {
    const holding = notFoundUnlessAllowed(await this.holdings.findById(scope, holdingId));
    const market = await lookupMarketPrices(this.marketPrices, [holding]);
    return buildHoldingView(holding, this.clock.now(), market);
  }
}

export class UpdateHolding {
  constructor(
    private readonly unitOfWork: InvestmentsUnitOfWork,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: AccessScope<'write'>,
    holdingId: string,
    patch: HoldingEditPatch,
  ): Promise<HoldingView> {
    const updated = await this.unitOfWork.run(async ({ holdings }) => {
      const existing = notFoundUnlessAllowed(await holdings.findForUpdate(scope, holdingId));
      const resolved = applyHoldingEdit(existing, patch);
      return notFoundUnlessAllowed(
        await holdings.update(scope, holdingId, {
          quantity: resolved.quantity,
          totalCost: resolved.totalCost,
          valuationCurrency: resolved.valuationCurrency,
          price: resolved.price,
        }),
      );
    });
    const market = await lookupMarketPrices(this.marketPrices, [updated]);
    return buildHoldingView(updated, this.clock.now(), market);
  }
}

export class SetManualPrice {
  constructor(
    private readonly holdings: HoldingRepository,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: AccessScope<'write'>,
    holdingId: string,
    unitPrice: bigint,
  ): Promise<HoldingView> {
    const now = this.clock.now();
    const holding = notFoundUnlessAllowed(
      await this.holdings.setPrice(scope, holdingId, unitPrice, 'manual', now),
    );
    const market = await lookupMarketPrices(this.marketPrices, [holding]);
    return buildHoldingView(holding, now, market);
  }
}

/** FR-06: takes the stored market price as the holding's own price, tagged automatic. */
export class UseAutomaticPrice {
  constructor(
    private readonly holdings: HoldingRepository,
    private readonly marketPrices: MarketPriceReader,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope<'write'>, holdingId: string): Promise<HoldingView> {
    const holding = notFoundUnlessAllowed(await this.holdings.findById(scope, holdingId));
    if (holding.instrumentType !== 'crypto') throw new InvestmentRuleViolation('marketPrice');
    const market = await lookupMarketPrices(this.marketPrices, [holding]);
    const stored = market.get(holding.ticker.toLowerCase());
    if (stored === undefined) throw new InvestmentRuleViolation('marketPrice');
    // The holding may have changed since the read; the guard makes the write fail instead of
    // landing the price on another ticker or on a non-crypto holding.
    const switched = await this.holdings.setPrice(
      scope,
      holdingId,
      stored.unitPrice,
      'automatic',
      stored.pricedAt,
      { instrumentType: 'crypto', ticker: holding.ticker.toLowerCase() },
    );
    if (switched === null) throw new InvestmentRuleViolation('marketPrice');
    return buildHoldingView(switched, this.clock.now(), market);
  }
}

export class DeleteHolding {
  constructor(private readonly holdings: HoldingRepository) {}

  async execute(scope: AccessScope<'write'>, holdingId: string): Promise<void> {
    if (!(await this.holdings.delete(scope, holdingId))) throw new ResourceNotFound();
  }
}
