import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TakeDailySnapshots } from '../../src/investments/application/take-daily-snapshots';
import {
  SNAPSHOT_POLL_INTERVAL_MS,
  SnapshotJob,
} from '../../src/investments/infrastructure/jobs/snapshot-job';
import { createSnapshotJob } from '../../src/investments/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../exchange-rates/fakes';
import { logEntries } from '../helpers/identity-harness';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { InMemorySnapshots, type FakePortfolio } from './fakes/in-memory-prices';
import { insertHolding, insertPortfolio } from './fakes/price-db';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const CREATED = new Date('2026-01-01T00:00:00.000Z');
const PRICED_AT = new Date('2026-02-01T00:00:00.000Z');

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

async function seedPortfolioIn(zone: string, email: string): Promise<string> {
  const owner = await seedUser(connection, {
    email,
    password: 'a-long-password-1',
    timeZone: zone,
  });
  const portfolio = await insertPortfolio(connection.pool, owner, { createdAt: CREATED });
  await insertHolding(connection.pool, {
    portfolioId: portfolio,
    ownerId: owner,
    ticker: 'btc',
    price: { unitPrice: 6_789_012n, source: 'manual', pricedAt: PRICED_AT },
  });
  return portfolio;
}

async function datesOf(portfolioId: string): Promise<string[]> {
  const result = await connection.pool.query<{ d: string }>(
    `select to_char(snapshot_date, 'YYYY-MM-DD') as d from portfolio_value_snapshots
     where portfolio_id = $1 order by snapshot_date`,
    [portfolioId],
  );
  return result.rows.map((row) => row.d);
}

describe('SnapshotJob', () => {
  it('polls every 5 minutes', () => {
    expect(SNAPSHOT_POLL_INTERVAL_MS).toBe(300_000);
  });

  it('just after local midnight in two zones each portfolio gets its own previous day once (AC-03)', async () => {
    const utc = await seedPortfolioIn('UTC', 'utc@snap-job.test');
    const ba = await seedPortfolioIn(BUENOS_AIRES, 'ba@snap-job.test');
    const clock = new MutableClock(new Date('2026-03-02T00:05:00.000Z'));
    const { lines, logger } = capturingLogger();
    const job = createSnapshotJob({ db: connection.db, logger, clock });

    const first = await job.runOnce();
    expect(first.saved).toBe(2);
    expect(await datesOf(utc)).toEqual(['2026-03-01']);
    expect(await datesOf(ba)).toEqual(['2026-02-28']);

    expect((await job.runOnce()).saved).toBe(0);
    expect(await datesOf(utc)).toEqual(['2026-03-01']);

    clock.advance(3 * 60 * 60_000);
    expect((await job.runOnce()).saved).toBe(1);
    expect(await datesOf(ba)).toEqual(['2026-02-28', '2026-03-01']);
    expect(await datesOf(utc)).toEqual(['2026-03-01']);

    const taken = logEntries(lines).find((entry) => entry.msg === 'daily snapshots taken');
    expect(taken).toMatchObject({ saved: 2, skippedOutOfRange: 0, skippedZones: 0 });
    expect(lines.join('')).not.toMatch(/6789012/);
  });

  it('a pass with an invalid zone logs it and continues with the other zones', async () => {
    const utc = await seedPortfolioIn('UTC', 'utc2@snap-job.test');
    await seedPortfolioIn('Mars/Olympus_Mons', 'mars@snap-job.test');
    const { lines, logger } = capturingLogger();
    const job = createSnapshotJob({
      db: connection.db,
      logger,
      clock: new MutableClock(new Date('2026-03-02T00:05:00.000Z')),
    });

    const result = await job.runOnce();

    expect(result).toMatchObject({ saved: 1, skippedZones: 1 });
    expect(await datesOf(utc)).toEqual(['2026-03-01']);
    const invalid = logEntries(lines).find(
      (entry) => entry.msg === 'snapshot skipped: invalid time zone',
    );
    expect(invalid).toMatchObject({ zone: 'Mars/Olympus_Mons' });
  });

  describe('with in-memory ports', () => {
    const SCALE = 100_000_000n;
    const huge: FakePortfolio['holdings'] = [
      { quantity: 10n ** 18n, unitPrice: 10n ** 12n, valuationCurrency: 'USD' },
    ];
    const ok: FakePortfolio['holdings'] = [
      { quantity: SCALE, unitPrice: 1_000n, valuationCurrency: 'USD' },
    ];

    function build() {
      const repo = new InMemorySnapshots();
      const clock = new MutableClock(new Date('2026-03-02T12:00:00.000Z'));
      const { lines, logger } = capturingLogger();
      const job = new SnapshotJob({
        snapshots: new TakeDailySnapshots({ snapshots: repo }),
        clock,
        logger,
        pollIntervalMs: 5,
      });
      const add = (id: string, zone: string, holdings: FakePortfolio['holdings']) =>
        repo.portfolios.push({ id, ownerId: `owner-${id}`, zone, createdAt: CREATED, holdings });
      return { repo, clock, lines, job, add };
    }

    const skips = (lines: string[]) =>
      logEntries(lines).filter((e) => e.msg === 'snapshot skipped: total out of range');

    it('an out-of-range total is logged once per zone and date and the pass continues (AC-04)', async () => {
      const { repo, clock, lines, job, add } = build();
      add('1-huge', 'UTC', huge);
      add('2-ok', 'UTC', ok);

      const first = await job.runOnce();
      expect(first).toMatchObject({ saved: 1, skippedOutOfRange: 1 });
      expect(repo.rowsOf('2-ok')).toHaveLength(1);
      expect(skips(lines)).toHaveLength(1);
      expect(skips(lines)[0]).toMatchObject({
        zone: 'UTC',
        date: '2026-03-01',
        portfolioId: '1-huge',
      });

      await job.runOnce();
      await job.runOnce();
      expect(skips(lines)).toHaveLength(1);

      clock.advance(24 * 60 * 60_000);
      await job.runOnce();
      expect(skips(lines)).toHaveLength(2);
      expect(skips(lines)[1]).toMatchObject({ date: '2026-03-02' });
    });

    it('logs the skip again once the portfolio was not out of range in between', async () => {
      const { repo, lines, job, add } = build();
      add('1-huge', 'UTC', huge);
      await job.runOnce();
      const portfolio = repo.portfolios[0];
      if (portfolio) portfolio.holdings = ok;
      await job.runOnce();
      if (portfolio) portfolio.holdings = huge;
      repo.rows.clear();
      await job.runOnce();
      expect(skips(lines)).toHaveLength(2);
    });

    it('the summary is info only when the pass did something, debug otherwise', async () => {
      const { clock, lines, job, add } = build();
      add('1-ok', 'UTC', ok);
      const summaries = () => logEntries(lines).filter((e) => e.msg === 'daily snapshots taken');

      await job.runOnce();
      await job.runOnce();
      expect(summaries().map((e) => e.level)).toEqual([30, 20]);

      add('2-bad-zone', 'Mars/Olympus_Mons', ok);
      await job.runOnce();
      expect(summaries()[2]?.level).toBe(30);

      clock.advance(24 * 60 * 60_000);
      await job.runOnce();
      expect(summaries()[3]?.level).toBe(30);
    });

    it('an out-of-range-only pass logs the summary at info', async () => {
      const { lines, job, add } = build();
      add('1-huge', 'UTC', huge);
      await job.runOnce();
      await job.runOnce();
      const levels = logEntries(lines)
        .filter((e) => e.msg === 'daily snapshots taken')
        .map((e) => e.level);
      expect(levels).toEqual([30, 30]);
    });

    it('an invalid time zone is logged once until it disappears and returns', async () => {
      const { repo, lines, job, add } = build();
      add('1-mars', 'Mars/Olympus_Mons', ok);
      const invalid = () =>
        logEntries(lines).filter((e) => e.msg === 'snapshot skipped: invalid time zone');

      await job.runOnce();
      await job.runOnce();
      await job.runOnce();
      expect(invalid()).toHaveLength(1);
      expect(invalid()[0]).toMatchObject({ zone: 'Mars/Olympus_Mons' });

      repo.portfolios.length = 0;
      await job.runOnce();
      add('2-mars', 'Mars/Olympus_Mons', ok);
      await job.runOnce();
      expect(invalid()).toHaveLength(2);
    });

    it('a failing pass is logged with the error and the next pass runs', async () => {
      const { repo, lines, job, add } = build();
      add('1-ok', 'UTC', ok);
      const original = repo.zonesInUse.bind(repo);
      let calls = 0;
      repo.zonesInUse = () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('connection lost')) : original();
      };

      job.start();
      for (let i = 0; i < 400 && repo.rows.size === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await job.stop();

      const errored = logEntries(lines).find((e) => e.msg === 'daily snapshots errored');
      expect(JSON.stringify(errored?.err)).toContain('connection lost');
      expect(repo.rowsOf('1-ok')).toHaveLength(1);
    });

    it('stop() waits for the pass in progress', async () => {
      const { repo, job, add } = build();
      add('1-ok', 'UTC', ok);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = repo.save.bind(repo);
      const state = { entered: false };
      repo.save = async (rows) => {
        state.entered = true;
        await gate;
        return original(rows);
      };

      job.start();
      for (let i = 0; i < 400 && !state.entered; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      let stopped = false;
      const stopping = job.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(stopped).toBe(false);
      release();
      await stopping;
      expect(repo.rowsOf('1-ok')).toHaveLength(1);
    });
  });
});
