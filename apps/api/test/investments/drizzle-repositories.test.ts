import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HoldingDraft } from '../../src/investments/application/ports';
import { DrizzleHoldingRepository } from '../../src/investments/infrastructure/db/drizzle-holding-repository';
import { DrizzlePortfolioRepository } from '../../src/investments/infrastructure/db/drizzle-portfolio-repository';
import { holdings, portfolios } from '../../src/investments/infrastructure/db/schema';
import { violatedUniqueConstraint } from '../../src/identity/infrastructure/db/unique-violation';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { seedUser } from '../helpers/session-client';
import { scopeFor } from './fakes/in-memory-investments';

let connection: DatabaseConnection;
let portfolioRepository: DrizzlePortfolioRepository;
let holdingRepository: DrizzleHoldingRepository;
let ana: string;
let bob: string;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  portfolioRepository = new DrizzlePortfolioRepository(connection.db);
  holdingRepository = new DrizzleHoldingRepository(connection.db);
});

beforeEach(async () => {
  ana = await seedUser(connection, { email: 'ana@repos.test', password: 'a-long-password-1' });
  bob = await seedUser(connection, { email: 'bob@repos.test', password: 'a-long-password-1' });
});

afterAll(async () => {
  await connection.pool.end();
});

const draft = (overrides: Partial<HoldingDraft> = {}): HoldingDraft => ({
  ticker: 'AAPL',
  instrumentName: 'Apple CEDEAR',
  instrumentType: 'cedear',
  quantity: 1_000_000_000n,
  valuationCurrency: 'ARS',
  totalCost: 15_000_000n,
  ...overrides,
});

/** The SQLSTATE and constraint of the pg error, which drizzle wraps in its cause chain. */
async function violation(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string } | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
      const code: unknown = Reflect.get(current, 'code');
      if (typeof code === 'string') {
        const constraint: unknown = Reflect.get(current, 'constraint');
        return {
          code,
          ...(typeof constraint === 'string' ? { constraint } : {}),
        };
      }
      current = current.cause;
    }
    throw error;
  }
}

async function portfolioOf(userId: string, name = 'Balanz') {
  return portfolioRepository.create(await scopeFor(userId, 'write'), name);
}

async function holdingOf(userId: string, portfolioId: string, overrides?: Partial<HoldingDraft>) {
  const holding = await holdingRepository.insert(
    await scopeFor(userId, 'write'),
    portfolioId,
    draft(overrides),
  );
  if (holding === null) throw new Error('the holding was not inserted');
  return holding;
}

describe('DrizzlePortfolioRepository', () => {
  it('creates a portfolio and reads it back (AC-01)', async () => {
    const created = await portfolioOf(ana);

    expect(created).toMatchObject({ name: 'Balanz' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await portfolioRepository.findById(await scopeFor(ana, 'read'), created.id)).toEqual(
      created,
    );
  });

  it('stores a portfolio named "\'; drop table holdings; --" and reads it back as plain data', async () => {
    const name = "'; drop table holdings; --";

    const created = await portfolioOf(ana, name);

    expect(created.name).toBe(name);
    expect(
      (await portfolioRepository.listForOwner(await scopeFor(ana, 'read'))).map((p) => p.name),
    ).toEqual([name]);
    await holdingOf(ana, created.id);
    const tables = await connection.pool.query(
      "select 1 from pg_tables where tablename = 'holdings'",
    );
    expect(tables.rowCount).toBe(1);
  });

  it("lists only the caller's portfolios, oldest first (AC-16)", async () => {
    const first = await portfolioOf(ana, 'First');
    await portfolioOf(bob, 'Bob');
    const second = await portfolioOf(ana, 'Second');

    expect(await portfolioRepository.listForOwner(await scopeFor(ana, 'read'))).toEqual([
      first,
      second,
    ]);
    expect(
      (await portfolioRepository.listForOwner(await scopeFor(bob, 'read'))).map((p) => p.name),
    ).toEqual(['Bob']);
  });

  it("answers null or false for another user's portfolio and changes nothing (AC-15)", async () => {
    const mine = await portfolioOf(ana);
    const foreignRead = await scopeFor(bob, 'read');
    const foreignWrite = await scopeFor(bob, 'write');

    expect(await portfolioRepository.findById(foreignRead, mine.id)).toBeNull();
    expect(await portfolioRepository.lockById(foreignWrite, mine.id)).toBeNull();
    expect(await portfolioRepository.delete(foreignWrite, mine.id)).toBe(false);
    expect(await portfolioRepository.delete(foreignWrite, randomUUID())).toBe(false);

    expect(await portfolioRepository.findById(await scopeFor(ana, 'read'), mine.id)).toEqual(mine);
  });

  it('locks the row with SELECT FOR UPDATE inside a transaction', async () => {
    const mine = await portfolioOf(ana);
    const scope = await scopeFor(ana, 'write');
    let second: Promise<unknown> | undefined;
    let secondDone = false;

    await connection.db.transaction(async (tx) => {
      const locking = new DrizzlePortfolioRepository(tx);
      expect(await locking.lockById(scope, mine.id)).toEqual(mine);
      second = connection.db
        .transaction(async (other) =>
          new DrizzlePortfolioRepository(other).lockById(scope, mine.id),
        )
        .then(() => {
          secondDone = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(secondDone).toBe(false);
    });
    await second;
    expect(secondDone).toBe(true);
  });

  it('locks a holding with SELECT FOR UPDATE until the first transaction ends', async () => {
    const portfolio = await portfolioOf(ana);
    const mine = await holdingOf(ana, portfolio.id);
    const scope = await scopeFor(ana, 'write');
    let second: Promise<unknown> | undefined;
    let secondDone = false;

    await connection.db.transaction(async (tx) => {
      const locking = new DrizzleHoldingRepository(tx);
      expect(await locking.findForUpdate(scope, mine.id)).toEqual(mine);
      second = connection.db
        .transaction(async (other) =>
          new DrizzleHoldingRepository(other).findForUpdate(scope, mine.id),
        )
        .then(() => {
          secondDone = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(secondDone).toBe(false);
    });
    await second;
    expect(secondDone).toBe(true);
  });

  it('deletes a portfolio with its holdings and leaves other rows alone (AC-17)', async () => {
    const mine = await portfolioOf(ana, 'Mine');
    const otherMine = await portfolioOf(ana, 'Other');
    const theirs = await portfolioOf(bob, 'Theirs');
    await holdingOf(ana, mine.id);
    await holdingOf(ana, mine.id, { ticker: 'MSFT' });
    await holdingOf(ana, otherMine.id);
    await holdingOf(bob, theirs.id);

    expect(await portfolioRepository.delete(await scopeFor(ana, 'write'), mine.id)).toBe(true);

    expect(await holdingRepository.listByPortfolio(await scopeFor(ana, 'read'), mine.id)).toEqual(
      [],
    );
    expect(await holdingRepository.listByOwner(await scopeFor(ana, 'read'))).toHaveLength(1);
    expect(await holdingRepository.listByOwner(await scopeFor(bob, 'read'))).toHaveLength(1);
    expect(await portfolioRepository.listForOwner(await scopeFor(ana, 'read'))).toEqual([
      otherMine,
    ]);
  });

  it('removes portfolios and holdings when their user is deleted', async () => {
    const mine = await portfolioOf(ana);
    await holdingOf(ana, mine.id);

    await connection.pool.query('delete from users where id = $1', [ana]);

    const left = await connection.pool.query(
      'select (select count(*) from portfolios) + (select count(*) from holdings) as n',
    );
    expect((left.rows[0] as { n: string }).n).toBe('0');
  });
});

describe('DrizzleHoldingRepository', () => {
  it('stores a holding without a price and reads it back with bigint values unchanged (AC-02)', async () => {
    const portfolio = await portfolioOf(ana);
    // above 2^53, where a JavaScript number would already have lost precision
    const quantity = 9_007_199_254_740_993n;
    const totalCost = 999_999_999_999_999n;

    const inserted = await holdingOf(ana, portfolio.id, { quantity, totalCost });

    expect(inserted).toEqual({
      id: inserted.id,
      portfolioId: portfolio.id,
      ticker: 'AAPL',
      instrumentName: 'Apple CEDEAR',
      instrumentType: 'cedear',
      quantity,
      valuationCurrency: 'ARS',
      totalCost,
      price: null,
    });
    expect(await holdingRepository.findById(await scopeFor(ana, 'read'), inserted.id)).toEqual(
      inserted,
    );
    expect(typeof inserted.quantity).toBe('bigint');
  });

  it('stores a missing total cost as null', async () => {
    const portfolio = await portfolioOf(ana);

    const inserted = await holdingOf(ana, portfolio.id, { totalCost: null });

    expect(inserted.totalCost).toBeNull();
  });

  it("answers null or false for another user's holding and changes no row (AC-15)", async () => {
    const portfolio = await portfolioOf(ana);
    const mine = await holdingOf(ana, portfolio.id);
    const foreignRead = await scopeFor(bob, 'read');
    const foreignWrite = await scopeFor(bob, 'write');

    expect(await holdingRepository.findById(foreignRead, mine.id)).toBeNull();
    expect(await holdingRepository.findForUpdate(foreignWrite, mine.id)).toBeNull();
    expect(await holdingRepository.findByTicker(foreignWrite, portfolio.id, 'AAPL')).toBeNull();
    expect(await holdingRepository.listByPortfolio(foreignRead, portfolio.id)).toEqual([]);
    expect(
      await holdingRepository.insert(foreignWrite, portfolio.id, draft({ ticker: 'X' })),
    ).toBeNull();
    expect(
      await holdingRepository.update(foreignWrite, mine.id, {
        quantity: 1n,
        totalCost: null,
        valuationCurrency: 'USD',
        price: null,
      }),
    ).toBeNull();
    expect(
      await holdingRepository.setPrice(foreignWrite, mine.id, 5n, 'manual', new Date()),
    ).toBeNull();
    expect(await holdingRepository.delete(foreignWrite, mine.id)).toBe(false);
    expect(await holdingRepository.findById(foreignRead, randomUUID())).toBeNull();

    expect(await holdingRepository.listByOwner(await scopeFor(ana, 'read'))).toEqual([mine]);
    expect(await holdingRepository.listByOwner(foreignRead)).toEqual([]);
  });

  it('answers null when inserting into a portfolio that does not exist', async () => {
    expect(
      await holdingRepository.insert(await scopeFor(ana, 'write'), randomUUID(), draft()),
    ).toBeNull();
  });

  it('lists holdings of the owner and of one portfolio ordered by ticker ignoring case', async () => {
    const first = await portfolioOf(ana, 'First');
    const second = await portfolioOf(ana, 'Second');
    await holdingOf(ana, first.id, { ticker: 'msft' });
    await holdingOf(ana, first.id, { ticker: 'AAPL' });
    await holdingOf(ana, first.id, { ticker: 'Bnd' });
    await holdingOf(ana, second.id, { ticker: 'zzz' });
    const read = await scopeFor(ana, 'read');

    expect((await holdingRepository.listByPortfolio(read, first.id)).map((h) => h.ticker)).toEqual([
      'AAPL',
      'Bnd',
      'msft',
    ]);
    expect((await holdingRepository.listByPortfolio(read, second.id)).map((h) => h.ticker)).toEqual(
      ['zzz'],
    );
    expect((await holdingRepository.listByOwner(read)).map((h) => h.ticker)).toEqual([
      'AAPL',
      'Bnd',
      'msft',
      'zzz',
    ]);
  });

  it('rejects "aapl" next to "AAPL" in one portfolio but allows the ticker in two portfolios (AC-23)', async () => {
    const first = await portfolioOf(ana, 'First');
    const second = await portfolioOf(ana, 'Second');
    await holdingOf(ana, first.id, { ticker: 'AAPL' });

    const duplicate = holdingRepository.insert(
      await scopeFor(ana, 'write'),
      first.id,
      draft({ ticker: 'aapl' }),
    );

    await expect(duplicate).rejects.toSatisfy(
      (error) => violatedUniqueConstraint(error) === 'holdings_portfolio_ticker_key',
    );
    await expect(holdingOf(ana, second.id, { ticker: 'aapl' })).resolves.toMatchObject({
      ticker: 'aapl',
    });
  });

  it('finds a holding by ticker ignoring case, only inside the given portfolio', async () => {
    const first = await portfolioOf(ana, 'First');
    const second = await portfolioOf(ana, 'Second');
    const inFirst = await holdingOf(ana, first.id, { ticker: 'AAPL' });
    const inSecond = await holdingOf(ana, second.id, { ticker: 'aapl', quantity: 5n });
    const scope = await scopeFor(ana, 'write');

    expect(await holdingRepository.findByTicker(scope, first.id, 'aApL')).toEqual(inFirst);
    expect(await holdingRepository.findByTicker(scope, second.id, 'AAPL')).toEqual(inSecond);
    expect(await holdingRepository.findByTicker(scope, first.id, 'MSFT')).toBeNull();
  });

  it('rejects crypto in ARS, quantity 0 and a half-filled price with check violations (AC-18)', async () => {
    const portfolio = await portfolioOf(ana);
    const scope = await scopeFor(ana, 'write');

    expect(
      await violation(
        holdingRepository.insert(
          scope,
          portfolio.id,
          draft({ ticker: 'BTC', instrumentType: 'crypto', valuationCurrency: 'ARS' }),
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'holdings_crypto_usd_check' });
    expect(
      await violation(holdingRepository.insert(scope, portfolio.id, draft({ quantity: 0n }))),
    ).toEqual({ code: '23514', constraint: 'holdings_quantity_check' });
    expect(
      await violation(
        connection.db.insert(holdings).values({
          portfolioId: portfolio.id,
          ownerId: ana,
          ticker: 'HALF',
          instrumentName: 'Half priced',
          instrumentType: 'stock',
          quantity: 1n,
          valuationCurrency: 'ARS',
          unitPrice: 5n,
        }),
      ),
    ).toEqual({ code: '23514', constraint: 'holdings_price_all_or_none_check' });
    await expect(
      holdingRepository.insert(
        scope,
        portfolio.id,
        draft({ ticker: 'BTC', instrumentType: 'crypto', valuationCurrency: 'USD' }),
      ),
    ).resolves.toMatchObject({ ticker: 'BTC' });
  });

  it("rejects a holding whose owner differs from its portfolio's owner (composite key)", async () => {
    const portfolio = await portfolioOf(ana);

    expect(
      await violation(
        connection.db.insert(holdings).values({
          portfolioId: portfolio.id,
          ownerId: bob,
          ticker: 'AAPL',
          instrumentName: 'Apple',
          instrumentType: 'cedear',
          quantity: 1n,
          valuationCurrency: 'ARS',
        }),
      ),
    ).toEqual({ code: '23503', constraint: 'holdings_portfolio_owner_fk' });
  });

  it('writes the resolved state on update, including a cleared price, and bumps updated_at', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id);
    const scope = await scopeFor(ana, 'write');
    const priced = await holdingRepository.setPrice(
      scope,
      created.id,
      1_850_000n,
      'manual',
      new Date('2026-10-01T12:00:00.000Z'),
    );
    const readUpdatedAt = async () => {
      const [row] = await connection.db
        .select({ updatedAt: holdings.updatedAt })
        .from(holdings)
        .where(eq(holdings.id, created.id));
      return row?.updatedAt.getTime() ?? 0;
    };
    const beforePrice = await readUpdatedAt();
    expect(priced?.price).toEqual({
      unitPrice: 1_850_000n,
      source: 'manual',
      pricedAt: new Date('2026-10-01T12:00:00.000Z'),
    });

    const kept = await holdingRepository.update(scope, created.id, {
      quantity: 1_500_000_000n,
      totalCost: 20_000_000n,
      valuationCurrency: 'ARS',
      price: priced?.price ?? null,
    });
    expect(kept).toMatchObject({ quantity: 1_500_000_000n, totalCost: 20_000_000n });
    expect(kept?.price).toEqual(priced?.price);
    const afterUpdate = await readUpdatedAt();
    expect(afterUpdate).toBeGreaterThanOrEqual(beforePrice);

    const cleared = await holdingRepository.update(scope, created.id, {
      quantity: 1_500_000_000n,
      totalCost: null,
      valuationCurrency: 'USD',
      price: null,
    });
    expect(cleared).toMatchObject({ valuationCurrency: 'USD', totalCost: null, price: null });
    const raw = await connection.pool.query(
      'select unit_price, price_source, priced_at from holdings where id = $1',
      [created.id],
    );
    expect(raw.rows).toEqual([{ unit_price: null, price_source: null, priced_at: null }]);
    expect(await holdingRepository.findById(await scopeFor(ana, 'read'), created.id)).toEqual(
      cleared,
    );
  });

  it('bumps updated_at when the price changes', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id);
    await connection.pool.query(
      "update holdings set updated_at = '2020-01-01T00:00:00Z' where id = $1",
      [created.id],
    );

    await holdingRepository.setPrice(
      await scopeFor(ana, 'write'),
      created.id,
      5n,
      'manual',
      new Date(),
    );

    const raw = await connection.pool.query<{ fresh: boolean }>(
      "select updated_at > '2020-01-02T00:00:00Z' as fresh from holdings where id = $1",
      [created.id],
    );
    expect(raw.rows[0]?.fresh).toBe(true);
  });

  it('bumps updated_at when the holding is updated', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id);
    await connection.pool.query(
      "update holdings set updated_at = '2020-01-01T00:00:00Z' where id = $1",
      [created.id],
    );

    await holdingRepository.update(await scopeFor(ana, 'write'), created.id, {
      quantity: 2n,
      totalCost: null,
      valuationCurrency: 'ARS',
      price: null,
    });

    const raw = await connection.pool.query<{ fresh: boolean }>(
      "select updated_at > '2020-01-02T00:00:00Z' as fresh from holdings where id = $1",
      [created.id],
    );
    expect(raw.rows[0]?.fresh).toBe(true);
  });

  it('deletes a holding and answers false the second time', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id);
    const scope = await scopeFor(ana, 'write');

    expect(await holdingRepository.delete(scope, created.id)).toBe(true);
    expect(await holdingRepository.delete(scope, created.id)).toBe(false);
    expect(await holdingRepository.findById(scope, created.id)).toBeNull();
  });

  it('applies a guarded price write only when the instrument type and lowercase ticker match', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id, {
      ticker: 'BTC',
      instrumentType: 'crypto',
      valuationCurrency: 'USD',
    });
    const scope = await scopeFor(ana, 'write');
    const at = new Date('2026-10-01T12:00:00.000Z');

    const mismatched = await holdingRepository.setPrice(scope, created.id, 5n, 'automatic', at, {
      instrumentType: 'stock',
      ticker: 'btc',
    });
    const otherTicker = await holdingRepository.setPrice(scope, created.id, 5n, 'automatic', at, {
      instrumentType: 'crypto',
      ticker: 'eth',
    });

    expect(mismatched).toBeNull();
    expect(otherTicker).toBeNull();
    expect((await holdingRepository.findById(scope, created.id))?.price).toBeNull();

    const matched = await holdingRepository.setPrice(scope, created.id, 6n, 'automatic', at, {
      instrumentType: 'crypto',
      ticker: 'btc',
    });

    expect(matched?.price).toEqual({ unitPrice: 6n, source: 'automatic', pricedAt: at });
  });

  it('rejects a price outside the stored limits with a check violation', async () => {
    const portfolio = await portfolioOf(ana);
    const created = await holdingOf(ana, portfolio.id);

    expect(
      await violation(
        holdingRepository.setPrice(
          await scopeFor(ana, 'write'),
          created.id,
          0n,
          'manual',
          new Date(),
        ),
      ),
    ).toMatchObject({ code: '23514' });
  });

  it('keeps every value out of the SQL text (bound parameters only)', async () => {
    const portfolio = await portfolioOf(ana);
    const hostile = "x'); delete from holdings; --";

    const inserted = await holdingOf(ana, portfolio.id, {
      ticker: 'SAFE',
      instrumentName: hostile,
    });

    expect(inserted.instrumentName).toBe(hostile);
    expect(
      await holdingRepository.findByTicker(
        await scopeFor(ana, 'write'),
        portfolio.id,
        "' or '1'='1",
      ),
    ).toBeNull();
    const [count] = await connection.db.select({ n: sql<string>`count(*)` }).from(portfolios);
    expect(count?.n).toBe('1');
  });
});
