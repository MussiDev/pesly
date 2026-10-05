import { ASSET_CATALOG, type AssetEntry } from './asset-catalog';

const BY_TICKER: ReadonlyMap<string, AssetEntry> = new Map(
  ASSET_CATALOG.map((entry) => [entry.ticker, entry]),
);

/** The catalog entry of a ticker, compared without case or surrounding spaces. */
export function resolveAsset(ticker: string | null | undefined): AssetEntry | undefined {
  if (ticker === null || ticker === undefined) return undefined;
  return BY_TICKER.get(ticker.trim().toUpperCase());
}
