import { describe, expect, it } from 'vitest';
import { ImportPlanError, planHoldingsImport } from '../src/investments/import-plan';

const holding = (id: string, ticker: string, instrumentType = 'cedear') => ({
  id,
  ticker,
  instrumentType,
});
const incoming = (ticker: string, extra: Record<string, string> = {}) => ({
  ticker,
  quantity: '100000000',
  ...extra,
});

describe('planHoldingsImport (DISC-001-07c FR-02, FR-03)', () => {
  it('splits the file into create, update and remove, matching tickers ignoring case (AC-02)', () => {
    const plan = planHoldingsImport(
      [holding('h1', 'ibit'), holding('h2', 'AAPL')],
      [incoming('IBIT'), incoming('SPY')],
    );

    expect(plan.create.map((row) => row.ticker)).toEqual(['SPY']);
    expect(plan.update.map(({ current, incoming: row }) => [current.id, row.ticker])).toEqual([
      ['h1', 'IBIT'],
    ]);
    expect(plan.remove.map((row) => row.id)).toEqual(['h2']);
  });

  it('carries the incoming row as is, so the file cost, currency and price win (AC-03, AC-09)', () => {
    const row = incoming('IBIT', { totalCost: '41949600', valuationCurrency: 'USD' });

    const plan = planHoldingsImport([holding('h1', 'IBIT')], [row]);

    expect(plan.update[0]?.incoming).toBe(row);
  });

  it('removes every current holding when the file has none of their tickers', () => {
    const plan = planHoldingsImport([holding('h1', 'AAPL')], [incoming('SPY')]);

    expect(plan.remove).toHaveLength(1);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('rejects a ticker repeated in the file, ignoring case (AC-05)', () => {
    expect(() => planHoldingsImport([], [incoming('ibit'), incoming('IBIT')])).toThrow(
      expect.objectContaining({ code: 'duplicateTicker' }),
    );
  });

  it('rejects a ticker that is an existing crypto holding (AC-05)', () => {
    expect(() => planHoldingsImport([holding('h1', 'btc', 'crypto')], [incoming('BTC')])).toThrow(
      expect.objectContaining({ code: 'cryptoTicker' }),
    );
  });

  it('keeps a crypto holding that the file does not mention out of the error path', () => {
    const plan = planHoldingsImport([holding('h1', 'BTC', 'crypto')], [incoming('SPY')]);

    expect(plan.remove.map((row) => row.id)).toEqual(['h1']);
  });

  it('names the failure by code only, never by ticker', () => {
    const error = new ImportPlanError('duplicateTicker');

    expect(error.message).toBe('duplicateTicker');
    expect(error).toBeInstanceOf(Error);
  });
});
