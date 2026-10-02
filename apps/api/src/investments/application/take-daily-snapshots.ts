import { holdingValue, totalsByCurrency, VALUATION_CURRENCIES } from '@pesly/shared';
import { localDateOf, previousDate } from '../domain/snapshot-date';
import type { SnapshotCandidate, SnapshotRepository, SnapshotRow } from './price-ports';

export const SNAPSHOT_PAGE_SIZE = 200;
/** The largest value of a bigint column. */
export const STORABLE_TOTAL_MAX = 2n ** 63n - 1n;

export interface OutOfRangeSnapshot {
  zone: string;
  date: string;
  portfolioId: string;
}

export interface TakeDailySnapshotsResult {
  /** Portfolios that got at least one new row; not the number of rows written. */
  saved: number;
  skippedOutOfRange: number;
  skippedZones: number;
  /** Extra detail for the caller to log (ids only); the counters above are the contract. */
  outOfRange: OutOfRangeSnapshot[];
  /** Extra detail for the caller to log. */
  invalidZones: string[];
}

export class TakeDailySnapshots {
  constructor(private readonly deps: { snapshots: SnapshotRepository }) {}

  async execute(now: Date): Promise<TakeDailySnapshotsResult> {
    const { snapshots } = this.deps;
    const result: TakeDailySnapshotsResult = {
      saved: 0,
      skippedOutOfRange: 0,
      skippedZones: 0,
      outOfRange: [],
      invalidZones: [],
    };

    for (const zone of await snapshots.zonesInUse()) {
      let date: string;
      try {
        date = previousDate(localDateOf(now, zone));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        result.skippedZones += 1;
        result.invalidZones.push(zone);
        continue;
      }

      let afterId: string | null = null;
      for (;;) {
        const page: SnapshotCandidate[] = await snapshots.portfoliosToSnapshot(
          zone,
          date,
          afterId,
          SNAPSHOT_PAGE_SIZE,
        );
        for (const candidate of page) {
          if (localDateOf(candidate.createdAt, zone) > date) continue;
          const rows = this.rowsFor(candidate, date, now);
          if (rows === 'out_of_range') {
            result.skippedOutOfRange += 1;
            result.outOfRange.push({ zone, date, portfolioId: candidate.portfolioId });
            continue;
          }
          if (rows.length === 0) continue;
          if ((await snapshots.save(rows)) > 0) result.saved += 1;
        }
        const last = page[page.length - 1];
        // A page that does not move the cursor would repeat forever; stop instead.
        if (!last || page.length < SNAPSHOT_PAGE_SIZE || last.portfolioId === afterId) break;
        afterId = last.portfolioId;
      }
    }
    return result;
  }

  private rowsFor(
    candidate: SnapshotCandidate,
    date: string,
    takenAt: Date,
  ): SnapshotRow[] | 'out_of_range' {
    const totals = totalsByCurrency(
      candidate.holdings.map((holding) => ({
        valuationCurrency: holding.valuationCurrency,
        value: holdingValue(holding.quantity, holding.unitPrice),
      })),
    );
    const rows: SnapshotRow[] = [];
    for (const currency of VALUATION_CURRENCIES) {
      if (!candidate.holdings.some((holding) => holding.valuationCurrency === currency)) continue;
      const totalValue = totals[currency];
      if (totalValue > STORABLE_TOTAL_MAX) return 'out_of_range';
      rows.push({
        portfolioId: candidate.portfolioId,
        ownerId: candidate.ownerId,
        date,
        currency,
        totalValue,
        takenAt,
      });
    }
    return rows;
  }
}
