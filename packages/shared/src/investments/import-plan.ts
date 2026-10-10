/** Why a file cannot be planned; only a code, never a ticker or a value. */
export type ImportPlanErrorCode = 'duplicateTicker' | 'cryptoTicker';

export class ImportPlanError extends Error {
  constructor(readonly code: ImportPlanErrorCode) {
    super(code);
    this.name = 'ImportPlanError';
  }
}

export interface ImportCurrentHolding {
  id: string;
  ticker: string;
  instrumentType: string;
}

export interface ImportPlan<
  Current extends ImportCurrentHolding,
  Incoming extends { ticker: string },
> {
  /** Tickers of the file that the portfolio does not have yet. */
  create: Incoming[];
  /** Tickers present on both sides; the incoming row wins, including its cost, currency and price. */
  update: { current: Current; incoming: Incoming }[];
  /** Current holdings whose ticker is not in the file. */
  remove: Current[];
}

/**
 * Compares the portfolio with the file by ticker, ignoring case. It is generic over both sides so
 * the browser (integer strings) and the API (bigint) share one rule.
 */
export function planHoldingsImport<
  Current extends ImportCurrentHolding,
  Incoming extends { ticker: string },
>(current: readonly Current[], incoming: readonly Incoming[]): ImportPlan<Current, Incoming> {
  const currentByTicker = new Map(
    current.map((holding) => [holding.ticker.toLowerCase(), holding]),
  );
  const seen = new Set<string>();
  const plan: ImportPlan<Current, Incoming> = { create: [], update: [], remove: [] };

  for (const row of incoming) {
    const key = row.ticker.toLowerCase();
    if (seen.has(key)) throw new ImportPlanError('duplicateTicker');
    seen.add(key);

    const existing = currentByTicker.get(key);
    if (existing === undefined) {
      plan.create.push(row);
    } else if (existing.instrumentType === 'crypto') {
      // Crypto is valued in USD from the automatic prices; a broker file never owns it.
      throw new ImportPlanError('cryptoTicker');
    } else {
      plan.update.push({ current: existing, incoming: row });
    }
  }

  plan.remove = current.filter((holding) => !seen.has(holding.ticker.toLowerCase()));
  return plan;
}
