import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/lib/logos/asset-catalog';
import { MERCHANT_CATALOG, type MerchantEntry } from '../src/lib/logos/merchant-catalog';
import { tokenize } from '../src/lib/logos/normalize';
import { resolveAsset } from '../src/lib/logos/resolve-asset';
import { createMerchantResolver, resolveMerchant } from '../src/lib/logos/resolve-merchant';

describe('tokenize', () => {
  it('lower-cases, strips accents and splits on anything that is not a letter or digit', () => {
    expect(tokenize('Mercado  Libré—PAGO 2x')).toEqual(['mercado', 'libre', 'pago', '2x']);
    expect(tokenize("McDonald's")).toEqual(['mcdonald', 's']);
  });

  it('returns no words for an empty, blank or symbol-only text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \t\n')).toEqual([]);
    expect(tokenize('—•—')).toEqual([]);
  });
});

describe('resolveMerchant (AC-18, AC-19, AC-20)', () => {
  it('matches a keyword inside a note regardless of case and accents', () => {
    expect(resolveMerchant('Suscripción SPOTIFY premium')?.id).toBe('spotify');
    expect(resolveMerchant('pago Mercado  Pagó mensual')?.id).toBe('mercadopago');
    expect(resolveMerchant('compra en McDonald’s')?.id).toBe('mcdonalds');
  });

  it('error: a keyword embedded in a longer word is not a match', () => {
    expect(resolveMerchant('spotifyfy')).toBeUndefined();
    expect(resolveMerchant('anetflixer')).toBeUndefined();
    expect(resolveMerchant('shellfish')).toBeUndefined();
  });

  it('prefers the entry whose matching keyword is longest', () => {
    // "apple music" is two words and beats "apple".
    expect(resolveMerchant('Apple Music familiar')?.id).toBe('applemusic');
    expect(resolveMerchant('Apple store')?.id).toBe('apple');
  });

  describe('ties and ordering', () => {
    const entry = (id: string, keywords: string[]): MerchantEntry => ({
      id,
      name: id,
      keywords,
      logo: `/logos/${id}.svg`,
    });

    it('lets the first listed entry win when the keyword lengths tie', () => {
      const resolve = createMerchantResolver([
        entry('first', ['alpha']),
        entry('second', ['gamma']),
      ]);

      expect(resolve('alpha gamma')?.id).toBe('first');
      expect(resolve('gamma alpha')?.id).toBe('first');
    });

    it('breaks a word-count tie by the longer keyword text', () => {
      const resolve = createMerchantResolver([entry('short', ['abc']), entry('long', ['abcdef'])]);

      expect(resolve('abc abcdef')?.id).toBe('long');
    });

    it('error: an entry whose keywords tokenize to nothing never matches', () => {
      const resolve = createMerchantResolver([entry('blank', ['', '—']), entry('real', ['real'])]);

      expect(resolve('anything at all')).toBeUndefined();
      expect(resolve('a real note')?.id).toBe('real');
    });
  });

  it('error: a null, undefined, empty or whitespace-only note resolves no entry', () => {
    expect(resolveMerchant(null)).toBeUndefined();
    expect(resolveMerchant(undefined)).toBeUndefined();
    expect(resolveMerchant('')).toBeUndefined();
    expect(resolveMerchant('   \n\t ')).toBeUndefined();
  });

  it('error: a note with no catalog keyword resolves no entry and never throws on odd text', () => {
    expect(resolveMerchant('almuerzo con amigos')).toBeUndefined();
    expect(resolveMerchant('\u0000​‮ control \u{1f4b8} chars')).toBeUndefined();
    expect(resolveMerchant('a'.repeat(500))).toBeUndefined();
    expect(resolveMerchant('spotify '.repeat(60))?.id).toBe('spotify');
  });

  it('resolves every catalog entry from its own first keyword', () => {
    for (const merchant of MERCHANT_CATALOG) {
      const keyword = merchant.keywords[0] ?? '';
      expect(resolveMerchant(`pago ${keyword}`)?.id, merchant.id).toBeDefined();
    }
  });
});

describe('resolveAsset (AC-24, AC-25)', () => {
  it('resolves a ticker regardless of case and surrounding spaces', () => {
    expect(resolveAsset('AAPL')?.logo).toBe('/logos/apple.svg');
    expect(resolveAsset('aapl')?.ticker).toBe('AAPL');
    expect(resolveAsset('  btc ')?.logo).toBe('/logos/bitcoin.svg');
  });

  it('error: an unknown, empty or missing ticker resolves no entry', () => {
    expect(resolveAsset('AL30')).toBeUndefined();
    expect(resolveAsset('GGAL')).toBeUndefined();
    expect(resolveAsset('')).toBeUndefined();
    expect(resolveAsset(null)).toBeUndefined();
    expect(resolveAsset(undefined)).toBeUndefined();
  });

  it('keeps every catalog ticker unique', () => {
    const tickers = ASSET_CATALOG.map((entry) => entry.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });
});
