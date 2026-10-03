import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotRow } from '../../src/investments/application/price-ports';
import { DrizzleSnapshotRepository } from '../../src/investments/infrastructure/db/drizzle-snapshot-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { insertHolding, insertPortfolio, sqlState } from './fakes/price-db';

let connection: DatabaseConnection;
let repository: DrizzleSnapshotRepository;
let ana: string;
let bob: string;

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleSnapshotRepository(connection.db);
});

beforeEach(async () => {
  ana = await seedUser(connection, {
    email: 'ana@snapshots.test',
    password: 'a-long-password-1',
    timeZone: BUENOS_AIRES,
  });
  bob = await seedUser(connection, {
    email: 'bob@snapshots.test',
    password: 'a-long-password-1',
    timeZone: 'UTC',
  });
});

afterAll(async () => {
  await connection.pool.end();
});

const DATE = '2026-10-01';
const TAKEN_AT = new Date('2026-10-02T03:05:00.000Z');
const PRICED_AT = new Date('2026-10-01T12:00:00.000Z');

const priced = (unitPrice: bigint) => ({
  unitPrice,
  source: 'manual' as const,
  pricedAt: PRICED_AT,
});

const row = (portfolioId: string, ownerId: string, overrides: Partial<SnapshotRow> = {}) => ({
  portfolioId,
  ownerId,
  date: DATE,
  currency: 'ARS' as const,
  totalValue: 185_000_00n,
  takenAt: TAKEN_AT,
  ...overrides,
});

async function storedRows(): Promise<
  { portfolioId: string; date: string; currency: string; totalValue: bigint }[]
> {
  const result = await connection.pool.query<{
    portfolio_id: string;
    snapshot_date: string;
    currency: string;
    total_value: string;
  }>(
    `select portfolio_id, to_char(snapshot_date, 'YYYY-MM-DD') as snapshot_date, currency, total_value
     from portfolio_value_snapshots order by snapshot_date, currency`,
  );
  return result.rows.map((r) => ({
    portfolioId: r.portfolio_id,
    date: r.snapshot_date,
    currency: r.currency,
    totalValue: BigInt(r.total_value),
  }));
}

describe('DrizzleSnapshotRepository.save', () => {
  it('stores every row of a portfolio and day, bigint totals included', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);

    const inserted = await repository.save([
      row(portfolio, ana, { currency: 'ARS', totalValue: 2n ** 63n - 1n }),
      row(portfolio, ana, { currency: 'USD', totalValue: 50_000n }),
    ]);

    expect(inserted).toBe(2);
    expect(await storedRows()).toEqual([
      { portfolioId: portfolio, date: DATE, currency: 'ARS', totalValue: 2n ** 63n - 1n },
      { portfolioId: portfolio, date: DATE, currency: 'USD', totalValue: 50_000n },
    ]);
    const stored = await connection.pool.query<{ taken_at: Date; owner_id: string }>(
      'select taken_at, owner_id from portfolio_value_snapshots limit 1',
    );
    expect(stored.rows[0]).toEqual({ taken_at: TAKEN_AT, owner_id: ana });
  });

  it('writes one set of rows when saving twice for the same portfolio and date (duplicate)', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);
    const rows = [
      row(portfolio, ana, { currency: 'ARS' }),
      row(portfolio, ana, { currency: 'USD', totalValue: 10n }),
    ];

    expect(await repository.save(rows)).toBe(2);
    expect(await repository.save(rows)).toBe(0);
    expect(await repository.save([row(portfolio, ana, { totalValue: 999n })])).toBe(0);

    expect(await storedRows()).toHaveLength(2);
    expect((await storedRows())[0]?.totalValue).toBe(185_000_00n);
  });

  it('returns only the rows actually written when some already exist', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);
    await repository.save([row(portfolio, ana, { currency: 'ARS' })]);

    const inserted = await repository.save([
      row(portfolio, ana, { currency: 'ARS' }),
      row(portfolio, ana, { currency: 'USD', totalValue: 5n }),
    ]);

    expect(inserted).toBe(1);
  });

  it('runs nothing for an empty list', async () => {
    expect(await repository.save([])).toBe(0);
    expect(await storedRows()).toEqual([]);
  });

  it('writes all currencies of a day or none: one invalid row undoes the others', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);

    await expect(
      repository.save([
        row(portfolio, ana, { currency: 'ARS' }),
        row(portfolio, ana, { currency: 'USD', totalValue: -1n }),
      ]),
    ).rejects.toThrow();

    expect(await storedRows()).toEqual([]);
  });

  it('rejects a snapshot whose owner differs from its portfolio owner (composite foreign key)', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);

    await expect(repository.save([row(portfolio, bob)])).rejects.toThrow();
    expect(
      await sqlState(
        connection.pool,
        `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
         values ($1, $2, '2026-10-01', 'ARS', 1, now())`,
        [portfolio, bob],
      ),
    ).toBe('23503');
    expect(await storedRows()).toEqual([]);
  });

  it('rejects a negative total and an unknown currency through the check constraints', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);
    const insert = (currency: string, total: string) =>
      sqlState(
        connection.pool,
        `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
         values ($1, $2, '2026-10-01', $3, $4::bigint, now())`,
        [portfolio, ana, currency, total],
      );

    expect(await insert('ARS', '-1')).toBe('23514');
    expect(await insert('EUR', '1')).toBe('23514');
    expect(await insert('ARS', '0')).toBeUndefined();
  });

  it('deletes the snapshots with their portfolio', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);
    await repository.save([row(portfolio, ana)]);

    await connection.pool.query('delete from portfolios where id = $1', [portfolio]);

    expect(await storedRows()).toEqual([]);
  });

  it('propagates a database error', async () => {
    const broken = createDatabase(testDatabaseUrl);
    const brokenRepository = new DrizzleSnapshotRepository(broken.db);
    await broken.pool.end();

    await expect(brokenRepository.save([row('p', ana)])).rejects.toThrow();
    await expect(brokenRepository.zonesInUse()).rejects.toThrow();
    await expect(brokenRepository.portfoliosToSnapshot('UTC', DATE, null, 10)).rejects.toThrow();
  });
});

describe('DrizzleSnapshotRepository.zonesInUse', () => {
  it('lists the distinct zones of users who own a portfolio', async () => {
    const third = await seedUser(connection, {
      email: 'eve@snapshots.test',
      password: 'a-long-password-1',
      timeZone: BUENOS_AIRES,
    });
    await seedUser(connection, {
      email: 'nobody@snapshots.test',
      password: 'a-long-password-1',
      timeZone: 'Asia/Tokyo',
    });
    await insertPortfolio(connection.pool, ana);
    await insertPortfolio(connection.pool, third);
    await insertPortfolio(connection.pool, bob);

    expect((await repository.zonesInUse()).sort()).toEqual([BUENOS_AIRES, 'UTC']);
  });

  it('is empty without portfolios', async () => {
    expect(await repository.zonesInUse()).toEqual([]);
  });
});

describe('DrizzleSnapshotRepository.portfoliosToSnapshot', () => {
  it('returns a portfolio with its priced holdings only, in its owner zone only', async () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const anaPortfolio = await insertPortfolio(connection.pool, ana, { createdAt });
    await insertHolding(connection.pool, {
      portfolioId: anaPortfolio,
      ownerId: ana,
      ticker: 'AAPL',
      type: 'cedear',
      currency: 'ARS',
      quantity: 1_000_000_000n,
      price: priced(18_500_000n),
    });
    await insertHolding(connection.pool, {
      portfolioId: anaPortfolio,
      ownerId: ana,
      ticker: 'btc',
      quantity: 50_000_000n,
      price: priced(100_000_00n),
    });
    await insertHolding(connection.pool, {
      portfolioId: anaPortfolio,
      ownerId: ana,
      ticker: 'unpriced',
      type: 'other',
      currency: 'ARS',
    });
    const bobPortfolio = await insertPortfolio(connection.pool, bob);
    await insertHolding(connection.pool, {
      portfolioId: bobPortfolio,
      ownerId: bob,
      ticker: 'eth',
      price: priced(250_000n),
    });

    const found = await repository.portfoliosToSnapshot(BUENOS_AIRES, DATE, null, 10);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ portfolioId: anaPortfolio, ownerId: ana, createdAt });
    expect(
      [...(found[0]?.holdings ?? [])].sort((a, b) => (a.quantity < b.quantity ? -1 : 1)),
    ).toEqual([
      { quantity: 50_000_000n, unitPrice: 100_000_00n, valuationCurrency: 'USD' },
      { quantity: 1_000_000_000n, unitPrice: 18_500_000n, valuationCurrency: 'ARS' },
    ]);
    const utc = await repository.portfoliosToSnapshot('UTC', DATE, null, 10);
    expect(utc.map((candidate) => candidate.portfolioId)).toEqual([bobPortfolio]);
    expect(await repository.portfoliosToSnapshot('Asia/Tokyo', DATE, null, 10)).toEqual([]);
  });

  it('excludes a portfolio without any priced holding', async () => {
    const portfolio = await insertPortfolio(connection.pool, ana);
    await insertHolding(connection.pool, {
      portfolioId: portfolio,
      ownerId: ana,
      ticker: 'unpriced',
      type: 'other',
      currency: 'ARS',
    });
    await insertPortfolio(connection.pool, ana, { name: 'Empty' });

    expect(await repository.portfoliosToSnapshot(BUENOS_AIRES, DATE, null, 10)).toEqual([]);
  });

  it('skips portfolios that already have a row for the date, whichever currency, but not for another date', async () => {
    const done = await insertPortfolio(connection.pool, ana, { name: 'Done' });
    const other = await insertPortfolio(connection.pool, ana, { name: 'Other day' });
    const pending = await insertPortfolio(connection.pool, ana, { name: 'Pending' });
    for (const portfolioId of [done, other, pending]) {
      await insertHolding(connection.pool, {
        portfolioId,
        ownerId: ana,
        ticker: 'btc',
        price: priced(100n),
      });
    }
    await repository.save([row(done, ana, { currency: 'USD' })]);
    await repository.save([row(other, ana, { date: '2026-09-30' })]);

    const found = await repository.portfoliosToSnapshot(BUENOS_AIRES, DATE, null, 10);

    expect(found.map((candidate) => candidate.portfolioId).sort()).toEqual([other, pending].sort());
  });

  it('pages by portfolio id after the cursor, up to the limit', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const portfolioId = await insertPortfolio(connection.pool, ana, { name: `P${index}` });
      await insertHolding(connection.pool, {
        portfolioId,
        ownerId: ana,
        ticker: 'btc',
        price: priced(100n),
      });
      ids.push(portfolioId);
    }
    ids.sort();

    const first = await repository.portfoliosToSnapshot(BUENOS_AIRES, DATE, null, 2);
    const second = await repository.portfoliosToSnapshot(
      BUENOS_AIRES,
      DATE,
      first[1]?.portfolioId ?? null,
      2,
    );
    const third = await repository.portfoliosToSnapshot(
      BUENOS_AIRES,
      DATE,
      second[1]?.portfolioId ?? null,
      2,
    );

    expect(first.map((c) => c.portfolioId)).toEqual(ids.slice(0, 2));
    expect(second.map((c) => c.portfolioId)).toEqual(ids.slice(2, 4));
    expect(third.map((c) => c.portfolioId)).toEqual(ids.slice(4));
  });

  it('keeps every holding of a portfolio together even when the page limit is smaller than its holdings', async () => {
    const portfolioId = await insertPortfolio(connection.pool, ana);
    for (const ticker of ['btc', 'eth', 'sol']) {
      await insertHolding(connection.pool, {
        portfolioId,
        ownerId: ana,
        ticker,
        price: priced(100n),
      });
    }

    const found = await repository.portfoliosToSnapshot(BUENOS_AIRES, DATE, null, 1);

    expect(found).toHaveLength(1);
    expect(found[0]?.holdings).toHaveLength(3);
  });
});
