import type { ListPortfolios } from '../../../investments';
import type { AccessScope } from '../../../shared/access';
import type {
  InvestmentValuation,
  InvestmentValue,
} from '../../application/ports/investment-valuation';

/** Values the investments live through the portfolios use case (owner decision 1), not a snapshot. */
export class PortfolioValuation implements InvestmentValuation {
  constructor(private readonly portfolios: Pick<ListPortfolios, 'execute'>) {}

  async valueNow(scope: AccessScope): Promise<InvestmentValue> {
    const views = await this.portfolios.execute(scope);
    const value: InvestmentValue = { ARS: 0n, USD: 0n, holdingsWithoutPrice: 0 };
    for (const view of views) {
      for (const total of view.totals) value[total.currency] += total.value;
      value.holdingsWithoutPrice += view.holdingsWithoutPrice;
    }
    return value;
  }
}
