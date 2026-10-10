import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../../../src/shared/http/auth-context';
import type {
  Clock,
  HoldingDraft,
  HoldingRepository,
  HoldingUpdate,
  InvestmentsRepositories,
  InvestmentsUnitOfWork,
  MarketPrice,
  MarketPriceReader,
  Portfolio,
  PortfolioRepository,
} from '../../../src/investments/application/ports';
import type { Holding } from '../../../src/investments/domain/holding';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessAction,
  type AccessScope,
} from '../../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../../src/shared/access/infrastructure/deny-all-group-membership-reader';

interface StoredPortfolio {
  portfolio: Portfolio;
  ownerId: string;
}

interface StoredHolding {
  holding: Holding;
  ownerId: string;
}

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function scopeFor<A extends AccessAction>(
  userId: string,
  action: A,
): Promise<AccessScope<A>> {
  const auth: AuthContext = { userId, sessionId: 'session', emailVerified: true };
  return policy.scopeFor(auth, action);
}

/** Stored market prices by lowercase symbol; records every lookup so tests can count them. */
export class InMemoryMarketPriceReader implements MarketPriceReader {
  readonly prices = new Map<string, MarketPrice>();
  /** One entry per `findMany` call, with the symbols asked. */
  readonly calls: string[][] = [];
  failure: Error | null = null;

  set(symbol: string, unitPrice: bigint, pricedAt: Date): void {
    this.prices.set(symbol.toLowerCase(), { unitPrice, pricedAt });
  }

  findMany(symbols: readonly string[]): Promise<ReadonlyMap<string, MarketPrice>> {
    this.calls.push([...symbols]);
    if (this.failure !== null) return Promise.reject(this.failure);
    const found = new Map<string, MarketPrice>();
    for (const symbol of symbols) {
      const price = this.prices.get(symbol);
      if (price !== undefined) found.set(symbol, price);
    }
    return Promise.resolve(found);
  }
}

/** Shared state of the fakes; a row owned by another user is invisible, as with the scoped SQL. */
export class InMemoryInvestments implements InvestmentsUnitOfWork {
  readonly portfolioRows = new Map<string, StoredPortfolio>();
  readonly holdingRows = new Map<string, StoredHolding>();
  /** Ordered log of repository calls, so tests can assert which locking reads a use case makes. */
  readonly calls: string[] = [];

  constructor(private readonly clock: Clock) {}

  readonly portfolios: PortfolioRepository = {
    create: (scope, name) => {
      const portfolio: Portfolio = { id: randomUUID(), name, createdAt: this.clock.now() };
      this.portfolioRows.set(portfolio.id, { portfolio, ownerId: scope.userId });
      return Promise.resolve(portfolio);
    },
    listForOwner: (scope) =>
      Promise.resolve(
        [...this.portfolioRows.values()]
          .filter((row) => row.ownerId === scope.userId)
          .map((row) => row.portfolio),
      ),
    findById: (scope, id) => Promise.resolve(this.visiblePortfolio(scope.userId, id)),
    lockById: (scope, id) => {
      this.calls.push('portfolios.lockById');
      return Promise.resolve(this.visiblePortfolio(scope.userId, id));
    },
    delete: (scope, id) => {
      if (this.visiblePortfolio(scope.userId, id) === null) return Promise.resolve(false);
      this.portfolioRows.delete(id);
      for (const [holdingId, row] of this.holdingRows) {
        if (row.holding.portfolioId === id) this.holdingRows.delete(holdingId);
      }
      return Promise.resolve(true);
    },
  };

  readonly holdings: HoldingRepository = {
    listByOwner: (scope) =>
      Promise.resolve(
        [...this.holdingRows.values()]
          .filter((row) => row.ownerId === scope.userId)
          .map((row) => row.holding),
      ),
    listByPortfolio: (scope, portfolioId) => {
      this.calls.push('holdings.listByPortfolio');
      return Promise.resolve(
        [...this.holdingRows.values()]
          .filter((row) => row.ownerId === scope.userId && row.holding.portfolioId === portfolioId)
          .map((row) => row.holding),
      );
    },
    findById: (scope, id) => {
      this.calls.push('holdings.findById');
      return Promise.resolve(this.visibleHolding(scope.userId, id));
    },
    findForUpdate: (scope, id) => {
      this.calls.push('holdings.findForUpdate');
      return Promise.resolve(this.visibleHolding(scope.userId, id));
    },
    findByTicker: (scope, portfolioId, ticker) => {
      this.calls.push('holdings.findByTicker');
      return Promise.resolve(
        [...this.holdingRows.values()].find(
          (row) =>
            row.ownerId === scope.userId &&
            row.holding.portfolioId === portfolioId &&
            row.holding.ticker.toLowerCase() === ticker.toLowerCase(),
        )?.holding ?? null,
      );
    },
    insert: (scope, portfolioId, draft: HoldingDraft) => {
      if (this.visiblePortfolio(scope.userId, portfolioId) === null) return Promise.resolve(null);
      const holding: Holding = { id: randomUUID(), portfolioId, ...draft, price: null };
      this.holdingRows.set(holding.id, { holding, ownerId: scope.userId });
      return Promise.resolve(holding);
    },
    update: (scope, id, fields: HoldingUpdate) => {
      const row = this.visibleRow(scope.userId, id);
      if (row === null) return Promise.resolve(null);
      row.holding = { ...row.holding, ...fields };
      return Promise.resolve(row.holding);
    },
    setPrice: (scope, id, unitPrice, source, pricedAt, guard) => {
      const row = this.visibleRow(scope.userId, id);
      if (row === null) return Promise.resolve(null);
      if (
        guard !== undefined &&
        (row.holding.instrumentType !== guard.instrumentType ||
          row.holding.ticker.toLowerCase() !== guard.ticker)
      ) {
        return Promise.resolve(null);
      }
      row.holding = { ...row.holding, price: { unitPrice, source, pricedAt } };
      return Promise.resolve(row.holding);
    },
    delete: (scope, id) => {
      if (this.visibleRow(scope.userId, id) === null) return Promise.resolve(false);
      this.holdingRows.delete(id);
      return Promise.resolve(true);
    },
  };

  /** Like a transaction: when `work` rejects, every row goes back to what it was. */
  async run<T>(work: (repositories: InvestmentsRepositories) => Promise<T>): Promise<T> {
    const portfolioSnapshot = new Map(this.portfolioRows);
    const holdingSnapshot = new Map(
      [...this.holdingRows].map(([id, row]) => [id, { ...row }] as const),
    );
    try {
      return await work({ portfolios: this.portfolios, holdings: this.holdings });
    } catch (error) {
      this.portfolioRows.clear();
      for (const [id, row] of portfolioSnapshot) this.portfolioRows.set(id, row);
      this.holdingRows.clear();
      for (const [id, row] of holdingSnapshot) this.holdingRows.set(id, row);
      throw error;
    }
  }

  private visiblePortfolio(userId: string, id: string): Portfolio | null {
    const row = this.portfolioRows.get(id);
    return row !== undefined && row.ownerId === userId ? row.portfolio : null;
  }

  private visibleRow(userId: string, id: string): StoredHolding | null {
    const row = this.holdingRows.get(id);
    return row !== undefined && row.ownerId === userId ? row : null;
  }

  private visibleHolding(userId: string, id: string): Holding | null {
    return this.visibleRow(userId, id)?.holding ?? null;
  }
}
