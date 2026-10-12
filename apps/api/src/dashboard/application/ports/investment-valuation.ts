import type { AccessScope } from '../../../shared/access';

export interface InvestmentValue {
  /** Minor units of each valuation currency; a holding with no price counts 0. */
  ARS: bigint;
  USD: bigint;
  holdingsWithoutPrice: number;
}

export interface InvestmentValuation {
  /** The holdings valued now from their stored prices; never calls a provider. */
  valueNow(scope: AccessScope): Promise<InvestmentValue>;
}
