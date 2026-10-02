import { beforeEach, describe, expect, it } from 'vitest';
import { holdingValue, totalsByCurrency } from '@pesly/shared';
import {
  SNAPSHOT_PAGE_SIZE,
  STORABLE_TOTAL_MAX,
  TakeDailySnapshots,
} from '../../src/investments/application/take-daily-snapshots';
import { InMemorySnapshots, type FakePortfolio } from './fakes/in-memory-prices';

const CREATED = new Date('2026-01-01T00:00:00.000Z');
const SCALE = 100_000_000n;
const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function portfolio(id: string, zone: string, holdings: FakePortfolio['holdings']): FakePortfolio {
  return { id, ownerId: `owner-${id}`, zone, createdAt: CREATED, holdings };
}

const ARS_HOLDING = {
  quantity: 10n * SCALE,
  unitPrice: 1_850_000n,
  valuationCurrency: 'ARS',
} as const;
const USD_HOLDING = { quantity: 5n * SCALE, unitPrice: 10_000n, valuationCurrency: 'USD' } as const;
const ARS_AND_USD: FakePortfolio['holdings'] = [ARS_HOLDING, USD_HOLDING];

describe('TakeDailySnapshots', () => {
  let repo: InMemorySnapshots;
  let take: TakeDailySnapshots;

  beforeEach(() => {
    repo = new InMemorySnapshots();
    take = new TakeDailySnapshots({ snapshots: repo });
  });

  it('exposes the page size and the storable limit', () => {
    expect(SNAPSHOT_PAGE_SIZE).toBe(200);
    expect(STORABLE_TOTAL_MAX).toBe(9_223_372_036_854_775_807n);
  });

  it('snapshots each user for their own previous local day at different instants, with the shared helper totals', async () => {
    repo.portfolios.push(
      portfolio('a-ba', BUENOS_AIRES, ARS_AND_USD),
      portfolio('b-utc', 'UTC', ARS_AND_USD),
    );
    const totals = totalsByCurrency(
      ARS_AND_USD.map((h) => ({
        valuationCurrency: h.valuationCurrency,
        value: holdingValue(h.quantity, h.unitPrice),
      })),
    );
    expect(totals).toEqual({ ARS: 18_500_000n, USD: 50_000n });

    const first = new Date('2026-03-02T00:30:00.000Z');
    const resultOne = await take.execute(first);

    expect(resultOne).toMatchObject({ saved: 2, skippedOutOfRange: 0, skippedZones: 0 });
    expect(repo.rowsOf('b-utc').map((r) => [r.date, r.currency, r.totalValue])).toEqual([
      ['2026-03-01', 'ARS', 18_500_000n],
      ['2026-03-01', 'USD', 50_000n],
    ]);
    expect(repo.rowsOf('a-ba').map((r) => [r.date, r.currency, r.totalValue])).toEqual([
      ['2026-02-28', 'ARS', 18_500_000n],
      ['2026-02-28', 'USD', 50_000n],
    ]);
    expect(repo.rowsOf('a-ba')[0]).toMatchObject({ ownerId: 'owner-a-ba', takenAt: first });

    const second = new Date('2026-03-02T03:30:00.000Z');
    const resultTwo = await take.execute(second);

    expect(resultTwo.saved).toBe(1);
    expect(repo.rowsOf('a-ba').map((r) => r.date)).toEqual([
      '2026-02-28',
      '2026-02-28',
      '2026-03-01',
      '2026-03-01',
    ]);
    expect(repo.rowsOf('b-utc')).toHaveLength(2);
  });

  it('writes only the currencies that have a priced holding', async () => {
    repo.portfolios.push(portfolio('p1', 'UTC', [ARS_HOLDING]));

    await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(repo.rowsOf('p1').map((r) => r.currency)).toEqual(['ARS']);
  });

  it('running twice for the same day writes one set of rows', async () => {
    repo.portfolios.push(portfolio('p1', 'UTC', ARS_AND_USD));
    const now = new Date('2026-03-02T12:00:00.000Z');

    const first = await take.execute(now);
    const second = await take.execute(now);

    expect(first.saved).toBe(1);
    expect(second.saved).toBe(0);
    expect(repo.rows.size).toBe(2);
  });

  it('a portfolio without priced holdings gets no row', async () => {
    repo.portfolios.push(portfolio('empty', 'UTC', []), portfolio('full', 'UTC', ARS_AND_USD));

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(result.saved).toBe(1);
    expect(repo.rowsOf('empty')).toEqual([]);
    expect(repo.saveCalls).toBe(1);
  });

  it('a zone that raises RangeError is skipped and counted while other zones continue (invalid zone)', async () => {
    repo.portfolios.push(
      portfolio('bad', 'Mars/Olympus_Mons', ARS_AND_USD),
      portfolio('good', 'UTC', ARS_AND_USD),
    );

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      saved: 1,
      skippedZones: 1,
      invalidZones: ['Mars/Olympus_Mons'],
    });
    expect(repo.rowsOf('bad')).toEqual([]);
    expect(repo.rowsOf('good')).toHaveLength(2);
  });

  it('skips a portfolio created after the local date being snapshotted', async () => {
    repo.portfolios.push({
      ...portfolio('new', 'UTC', ARS_AND_USD),
      createdAt: new Date('2026-03-02T08:00:00.000Z'),
    });
    repo.portfolios.push({
      ...portfolio('same-day', 'UTC', ARS_AND_USD),
      createdAt: new Date('2026-03-01T23:00:00.000Z'),
    });

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(result.saved).toBe(1);
    expect(repo.rowsOf('new')).toEqual([]);
    expect(repo.rowsOf('same-day')).toHaveLength(2);
  });

  it('a total above 9,223,372,036,854,775,807 minor units is skipped and counted while the others are saved (error: out of range)', async () => {
    const huge: FakePortfolio['holdings'] = [
      { quantity: 10n ** 18n, unitPrice: 10n ** 12n, valuationCurrency: 'USD' },
    ];
    const edge: FakePortfolio['holdings'] = [
      { quantity: SCALE, unitPrice: 9_223_372_036_854_775_807n, valuationCurrency: 'ARS' },
    ];
    repo.portfolios.push(
      portfolio('1-ok', 'UTC', ARS_AND_USD),
      portfolio('2-huge', 'UTC', huge),
      portfolio('3-ok', 'UTC', ARS_AND_USD),
      portfolio('4-edge', 'UTC', edge),
    );

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(result).toMatchObject({ saved: 3, skippedOutOfRange: 1 });
    expect(result.outOfRange).toEqual([{ zone: 'UTC', date: '2026-03-01', portfolioId: '2-huge' }]);
    expect(repo.rowsOf('2-huge')).toEqual([]);
    expect(repo.rowsOf('1-ok')).toHaveLength(2);
    expect(repo.rowsOf('3-ok')).toHaveLength(2);
    expect(repo.rowsOf('4-edge')[0]?.totalValue).toBe(9_223_372_036_854_775_807n);
  });

  it('walks portfolios in pages of 200 by id', async () => {
    for (let index = 0; index < 450; index += 1) {
      repo.portfolios.push(portfolio(`p${String(index).padStart(4, '0')}`, 'UTC', ARS_AND_USD));
    }

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(result.saved).toBe(450);
    expect(repo.pageRequests.map((r) => [r.afterId, r.limit])).toEqual([
      [null, 200],
      ['p0199', 200],
      ['p0399', 200],
    ]);
  });

  it('stops when a page does not advance the cursor instead of looping forever', async () => {
    for (let index = 0; index < SNAPSHOT_PAGE_SIZE; index += 1) {
      repo.portfolios.push(portfolio(`p${String(index).padStart(4, '0')}`, 'UTC', ARS_AND_USD));
    }
    const page = repo.portfolios.map((p) => ({
      portfolioId: p.id,
      ownerId: p.ownerId,
      createdAt: p.createdAt,
      holdings: p.holdings,
    }));
    let requests = 0;
    // A repository that ignores the cursor and always answers the same full page.
    repo.portfoliosToSnapshot = () => {
      requests += 1;
      if (requests > 5) return Promise.reject(new Error('looped past the cursor guard'));
      return Promise.resolve(page);
    };

    const result = await take.execute(new Date('2026-03-02T12:00:00.000Z'));

    expect(requests).toBe(2);
    expect(result.saved).toBe(SNAPSHOT_PAGE_SIZE);
  });

  it('a storage error propagates', async () => {
    repo.portfolios.push(portfolio('p1', 'UTC', ARS_AND_USD));
    repo.save = () => Promise.reject(new Error('connection lost'));

    await expect(take.execute(new Date('2026-03-02T12:00:00.000Z'))).rejects.toThrow(
      'connection lost',
    );
  });
});
