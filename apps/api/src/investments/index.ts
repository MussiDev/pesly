import { Router } from 'express';
import type { RouterFactory } from '../app';
import { OwnerOrGroupMemberAccessPolicy } from '../shared/access';
import { DenyAllGroupMembershipReader } from '../shared/access/infrastructure/deny-all-group-membership-reader';
import { requireVerifiedEmail } from '../shared/http/require-verified-email';
import type { Logger } from '../shared/logging/logger';
import {
  AddHolding,
  DeleteHolding,
  GetHolding,
  SetManualPrice,
  UpdateHolding,
  UseAutomaticPrice,
} from './application/holding-use-cases';
import {
  CreatePortfolio,
  DeletePortfolio,
  GetPortfolio,
  ListPortfolios,
} from './application/portfolio-use-cases';
import type { Clock } from './application/ports';
import { DrizzleHoldingRepository } from './infrastructure/db/drizzle-holding-repository';
import { DrizzleMarketPriceReader } from './infrastructure/db/drizzle-market-price-reader';
import { DrizzleInvestmentsUnitOfWork } from './infrastructure/db/drizzle-unit-of-work';
import { DrizzlePortfolioRepository } from './infrastructure/db/drizzle-portfolio-repository';
import type { InvestmentsDb } from './infrastructure/db/schema';
import { holdingRoutes } from './infrastructure/http/holding-routes';
import { portfolioRoutes } from './infrastructure/http/portfolio-routes';
import { systemClock } from './infrastructure/system-clock';

export interface InvestmentsRoutesOptions {
  db: InvestmentsDb;
  /** Defaults to the module's own system clock. */
  clock?: Clock;
  logger: Logger;
}

/** Composition root of the investments module: repositories, use cases, policy and routers. */
export function createInvestmentsRoutes({
  db,
  clock = systemClock,
  logger,
}: InvestmentsRoutesOptions): RouterFactory {
  // No group sharing until PRD 05: nobody is a member, so only owners see their rows.
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const portfolios = new DrizzlePortfolioRepository(db);
  const holdings = new DrizzleHoldingRepository(db);
  const unitOfWork = new DrizzleInvestmentsUnitOfWork(db);
  // Read-only reader: the API never imports the worker repository that writes these prices.
  const marketPrices = new DrizzleMarketPriceReader(db);

  return ({ requireSession }) => {
    const router = Router();
    router.use('/investments', requireSession, requireVerifiedEmail);
    router.use(
      portfolioRoutes({
        policy,
        logger,
        createPortfolio: new CreatePortfolio(portfolios, marketPrices, clock),
        listPortfolios: new ListPortfolios(portfolios, holdings, marketPrices, clock),
        getPortfolio: new GetPortfolio(portfolios, holdings, marketPrices, clock),
        deletePortfolio: new DeletePortfolio(portfolios),
      }),
    );
    router.use(
      holdingRoutes({
        policy,
        logger,
        addHolding: new AddHolding(unitOfWork, marketPrices, clock),
        getHolding: new GetHolding(holdings, marketPrices, clock),
        updateHolding: new UpdateHolding(unitOfWork, marketPrices, clock),
        setManualPrice: new SetManualPrice(holdings, marketPrices, clock),
        useAutomaticPrice: new UseAutomaticPrice(holdings, marketPrices, clock),
        deleteHolding: new DeleteHolding(holdings),
      }),
    );
    return router;
  };
}
