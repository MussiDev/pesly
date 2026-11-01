import { describe, expect, it } from 'vitest';
import {
  cardCategoryRulesResponseSchema,
  createStatementImportRequestSchema,
  merchantKey,
  normalizeMerchantText,
  suggestCategory,
  type SuggestableCategory,
} from '../src';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NO_RULES = new Map<string, string>();

const DEFAULTS: SuggestableCategory[] = [
  { id: ID(1), key: 'transport', label: 'Transporte' },
  { id: ID(2), key: 'transport.fuel', label: 'Nafta' },
  { id: ID(3), key: 'food', label: 'Comida' },
  { id: ID(4), key: 'food.groceries', label: 'Supermercado' },
  { id: ID(5), key: 'entertainment.streaming', label: 'Streaming' },
  { id: ID(6), key: 'taxes', label: 'Impuestos y comisiones' },
  { id: ID(7), key: 'shopping', label: 'Compras' },
];
const purchase = (description: string) => ({ description, kind: 'purchase' as const });

describe('merchantKey', () => {
  it('keeps the first three words without digits, lowercased and without accents', () => {
    expect(merchantKey('CHEVROLET SA PLAN 12/84')).toBe('chevrolet sa plan');
    expect(merchantKey('CHEVROLET SA PLAN 13/84')).toBe('chevrolet sa plan');
    expect(merchantKey('MERPAGO*KIOSCO JOSÉ 0001')).toBe('merpago kiosco jose');
    expect(merchantKey('  Café   Martínez  ')).toBe('cafe martinez');
  });

  it('is null when no word is left', () => {
    expect(merchantKey('1234 5678/90')).toBeNull();
    expect(merchantKey('***')).toBeNull();
  });

  it('caps the key at 80 characters and never ends it with a space', () => {
    expect(merchantKey(`${'a'.repeat(100)}`)?.length).toBe(80);
    expect(merchantKey(`${'a'.repeat(80)} bbb`)).toBe('a'.repeat(80));
    expect(merchantKey(`${'a'.repeat(79)} bbb`)).toBe('a'.repeat(79));
  });
});

describe('normalizeMerchantText', () => {
  it('turns symbols into single spaces', () => {
    expect(normalizeMerchantText('PEDIDOSYA*Ñandú--Bar')).toBe('pedidosya nandu bar');
  });

  it('always yields a key the rules schema accepts, even for letters that lowercase oddly', () => {
    for (const description of ['İSTANBUL ŞEHİR', 'ǅUNGLA', 'ΣΟΦΙΑ', '東京 店', 'Ⅻ Roman']) {
      const key = merchantKey(description);
      if (key === null) continue;
      expect(
        cardCategoryRulesResponseSchema.safeParse({
          rules: [{ merchantKey: key, categoryId: ID(1) }],
        }).success,
      ).toBe(true);
    }
  });
});

describe('suggestCategory', () => {
  it('suggests a user category named "Auto" for a Chevrolet line (the user example)', () => {
    const categories = [...DEFAULTS, { id: ID(9), key: null, label: 'Auto' }];

    expect(suggestCategory(purchase('CHEVROLET SA PLAN 12/84'), NO_RULES, categories)).toEqual({
      categoryId: ID(9),
      source: 'keyword',
    });
  });

  it('falls back to the default category of the group, then to its parent', () => {
    expect(suggestCategory(purchase('CHEVROLET SA'), NO_RULES, DEFAULTS)?.categoryId).toBe(ID(1));
    expect(suggestCategory(purchase('YPF 1234 PILAR'), NO_RULES, DEFAULTS)?.categoryId).toBe(ID(2));
    const withoutFuel = DEFAULTS.filter((category) => category.key !== 'transport.fuel');
    expect(suggestCategory(purchase('YPF'), NO_RULES, withoutFuel)?.categoryId).toBe(ID(1));
  });

  it('matches common merchants of each group', () => {
    const cases: [string, number][] = [
      ['COTO CICSA 123', 4],
      ['DIA TIENDA 45', 4],
      ['NETFLIX.COM', 5],
      ['MERPAGO*MERCADOLIBRE', 7],
      ['DB.RG 5617 PERCEPCION 30%', 6],
    ];
    for (const [description, id] of cases) {
      expect(suggestCategory(purchase(description), NO_RULES, DEFAULTS)?.categoryId).toBe(ID(id));
    }
  });

  it('matches a long keyword as the start of a word and a short one only as a whole word', () => {
    const categories = [...DEFAULTS, { id: ID(8), key: 'food.restaurants', label: 'Restaurantes' }];
    expect(suggestCategory(purchase('MCDONALDS 123'), NO_RULES, categories)?.categoryId).toBe(
      ID(8),
    );
    expect(suggestCategory(purchase('DIARIO LA NACION'), NO_RULES, DEFAULTS)).toBeNull();
    expect(suggestCategory(purchase('DISCOTECA X'), NO_RULES, DEFAULTS)).toBeNull();
  });

  it('prefers the rule the user taught over the dictionary', () => {
    const rules = new Map([['chevrolet sa plan', ID(3)]]);

    expect(suggestCategory(purchase('CHEVROLET SA PLAN 13/84'), rules, DEFAULTS)).toEqual({
      categoryId: ID(3),
      source: 'learned',
    });
  });

  it('ignores a rule whose category is no longer open and uses the dictionary', () => {
    const rules = new Map([['ypf', ID(99)]]);

    expect(suggestCategory(purchase('YPF'), rules, DEFAULTS)).toEqual({
      categoryId: ID(2),
      source: 'keyword',
    });
  });

  it('suggests the taxes category for a fee line with an unknown description', () => {
    expect(suggestCategory({ description: 'CARGO XYZ', kind: 'fee' }, NO_RULES, DEFAULTS)).toEqual({
      categoryId: ID(6),
      source: 'keyword',
    });
  });

  it('suggests nothing for an unknown merchant or when no category fits', () => {
    expect(suggestCategory(purchase('KIOSCO JUAN'), NO_RULES, DEFAULTS)).toBeNull();
    expect(suggestCategory(purchase('NETFLIX'), NO_RULES, [])).toBeNull();
  });
});

describe('statement import contract with per-line categories', () => {
  const line = (extra: Record<string, unknown> = {}) => ({
    date: '2026-09-10',
    description: 'Chevrolet',
    voucher: null,
    currency: 'ARS',
    amount: '100',
    installmentNumber: null,
    installmentCount: null,
    kind: 'purchase',
    ...extra,
  });

  it('accepts a line category and no import category when every line has one', () => {
    expect(
      createStatementImportRequestSchema.safeParse({
        closingDate: '2026-09-24',
        lines: [line({ categoryId: ID(1) })],
      }).success,
    ).toBe(true);
  });

  it('refuses a line without category when the import has none, and a malformed id', () => {
    expect(
      createStatementImportRequestSchema.safeParse({
        closingDate: '2026-09-24',
        lines: [line({ categoryId: ID(1) }), line()],
      }).success,
    ).toBe(false);
    expect(
      createStatementImportRequestSchema.safeParse({
        closingDate: '2026-09-24',
        categoryId: ID(1),
        lines: [line({ categoryId: 'car' })],
      }).success,
    ).toBe(false);
  });

  it('parses the rules response and refuses a key with digits or capitals', () => {
    expect(
      cardCategoryRulesResponseSchema.safeParse({
        rules: [{ merchantKey: 'chevrolet sa plan', categoryId: ID(1) }],
      }).success,
    ).toBe(true);
    for (const merchantKey of ['ypf 123', 'YPF', '', ' ypf']) {
      expect(
        cardCategoryRulesResponseSchema.safeParse({ rules: [{ merchantKey, categoryId: ID(1) }] })
          .success,
      ).toBe(false);
    }
  });
});
