export interface MerchantEntry {
  id: string;
  /** The display name. */
  name: string;
  /** Words or phrases a movement note can carry; matched as whole words, ignoring case and accents. */
  keywords: readonly string[];
  /** A constant path under `/logos/`: never built from user input. */
  logo: string;
}

function merchant(id: string, name: string, keywords: readonly string[], file = id): MerchantEntry {
  return { id, name, keywords, logo: `/logos/${file}.svg` };
}

/**
 * Merchants and services whose logo is bundled (see `public/logos/NOTICE.md`). Order matters only
 * when two keywords match with the same length: the entry listed first wins. A merchant whose logo
 * is not cleared for redistribution is not listed, and its rows keep the category icon.
 */
export const MERCHANT_CATALOG: readonly MerchantEntry[] = [
  merchant('spotify', 'Spotify', ['spotify']),
  merchant('netflix', 'Netflix', ['netflix']),
  merchant('mercadopago', 'Mercado Pago', ['mercado pago', 'mercadopago']),
  merchant('uber', 'Uber', ['uber']),
  merchant('ubereats', 'Uber Eats', ['uber eats', 'ubereats']),
  merchant('apple', 'Apple', ['apple', 'itunes']),
  merchant('applemusic', 'Apple Music', ['apple music']),
  merchant('google', 'Google', ['google']),
  merchant('youtube', 'YouTube', ['youtube']),
  merchant('hbomax', 'HBO Max', ['hbo max', 'hbomax', 'hbo']),
  merchant('steam', 'Steam', ['steam']),
  merchant('playstation', 'PlayStation', ['playstation', 'psn']),
  merchant('paypal', 'PayPal', ['paypal']),
  merchant('airbnb', 'Airbnb', ['airbnb']),
  merchant('bookingdotcom', 'Booking.com', ['booking']),
  merchant('mcdonalds', "McDonald's", ['mcdonalds', 'mcdonald']),
  merchant('starbucks', 'Starbucks', ['starbucks']),
  merchant('burgerking', 'Burger King', ['burger king']),
  merchant('kfc', 'KFC', ['kfc']),
  merchant('carrefour', 'Carrefour', ['carrefour']),
  merchant('ikea', 'IKEA', ['ikea']),
  merchant('shell', 'Shell', ['shell']),
  merchant('whatsapp', 'WhatsApp', ['whatsapp']),
  merchant('instagram', 'Instagram', ['instagram']),
  merchant('facebook', 'Facebook', ['facebook']),
  merchant('telegram', 'Telegram', ['telegram']),
  merchant('github', 'GitHub', ['github']),
  merchant('tiktok', 'TikTok', ['tiktok']),
  merchant('twitch', 'Twitch', ['twitch']),
  merchant('discord', 'Discord', ['discord']),
  merchant('dropbox', 'Dropbox', ['dropbox']),
  merchant('figma', 'Figma', ['figma']),
  merchant('notion', 'Notion', ['notion']),
  merchant('aliexpress', 'AliExpress', ['aliexpress']),
  merchant('ebay', 'eBay', ['ebay']),
  merchant('nike', 'Nike', ['nike']),
  merchant('samsung', 'Samsung', ['samsung']),
  merchant('movistar', 'Movistar', ['movistar']),
  merchant('deezer', 'Deezer', ['deezer']),
  merchant('duolingo', 'Duolingo', ['duolingo']),
];
