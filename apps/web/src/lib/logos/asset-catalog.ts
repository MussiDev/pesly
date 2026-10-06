export interface AssetEntry {
  /** Upper-case, as holdings store it. */
  ticker: string;
  name: string;
  /** A constant path under `/logos/`: never built from user input. */
  logo: string;
}

function asset(ticker: string, name: string, file: string): AssetEntry {
  return { ticker, name, logo: `/logos/${file}.svg` };
}

/**
 * Tickers whose logo is bundled (see `public/logos/NOTICE.md`). Argentine equities and bonds have
 * no cleared logo, so their rows show the ticker initials instead.
 */
export const ASSET_CATALOG: readonly AssetEntry[] = [
  asset('AAPL', 'Apple', 'apple'),
  asset('GOOGL', 'Alphabet (Class A)', 'google'),
  asset('GOOG', 'Alphabet (Class C)', 'google'),
  asset('TSLA', 'Tesla', 'tesla'),
  asset('META', 'Meta', 'meta'),
  asset('NVDA', 'NVIDIA', 'nvidia'),
  asset('NFLX', 'Netflix', 'netflix'),
  asset('KO', 'Coca-Cola', 'cocacola'),
  asset('MCD', "McDonald's", 'mcdonalds'),
  asset('V', 'Visa', 'visa'),
  asset('MA', 'Mastercard', 'mastercard'),
  asset('PYPL', 'PayPal', 'paypal'),
  asset('BABA', 'Alibaba', 'alibabadotcom'),
  asset('INTC', 'Intel', 'intel'),
  asset('AMD', 'AMD', 'amd'),
  asset('SPOT', 'Spotify', 'spotify'),
  asset('UBER', 'Uber', 'uber'),
  asset('ABNB', 'Airbnb', 'airbnb'),
  asset('SHOP', 'Shopify', 'shopify'),
  asset('NKE', 'Nike', 'nike'),
  asset('COIN', 'Coinbase', 'coinbase'),
  asset('BTC', 'Bitcoin', 'bitcoin'),
  asset('ETH', 'Ethereum', 'ethereum'),
  asset('USDT', 'Tether', 'tether'),
  asset('SOL', 'Solana', 'solana'),
  asset('BNB', 'BNB', 'binance'),
  asset('XRP', 'XRP', 'xrp'),
  asset('ADA', 'Cardano', 'cardano'),
  asset('DOGE', 'Dogecoin', 'dogecoin'),
  asset('LTC', 'Litecoin', 'litecoin'),
  asset('MATIC', 'Polygon', 'polygon'),
  asset('LINK', 'Chainlink', 'chainlink'),
];
