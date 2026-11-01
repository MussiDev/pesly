import { z } from 'zod';

/**
 * Category suggestions for imported statement lines (FEAT-016). Pure and shared: the API learns a
 * rule from the merchant key of each line the user categorized, and the web suggests a category per
 * line from those rules first and from a dictionary of common Argentine merchants second.
 *
 * The keywords and category synonyms below are matching data, not UI copy: they are never shown.
 */

/** Most words of a description that make its merchant key. */
const MERCHANT_KEY_WORDS = 3;
export const MERCHANT_KEY_MAX_LENGTH = 80;

/** Lowercase, no accents, lowercase letters and digits only, single spaces. */
export function normalizeMerchantText(text: string): string {
  // Lowercase first: lowercasing can add a combining mark ("İ"), which the next step removes.
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{Ll}\p{Lo}\p{Lm}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * What identifies the merchant of a statement line across statements: its first three words that
 * carry no digit, so "CHEVROLET SA PLAN 12/84" and "CHEVROLET SA PLAN 13/84" share
 * "chevrolet sa plan". `null` when the description has no such word.
 */
export function merchantKey(description: string): string | null {
  const words = normalizeMerchantText(description)
    .split(' ')
    .filter((word) => word !== '' && !/\p{N}/u.test(word))
    .slice(0, MERCHANT_KEY_WORDS);
  if (words.length === 0) return null;
  return words.join(' ').slice(0, MERCHANT_KEY_MAX_LENGTH).trimEnd();
}

export const merchantKeySchema = z
  .string()
  .min(1)
  .max(MERCHANT_KEY_MAX_LENGTH)
  .regex(/^[\p{Ll}\p{Lo}\p{Lm}]+( [\p{Ll}\p{Lo}\p{Lm}]+)*$/u);

/** `GET /credit-cards/category-rules`: what the user taught, one category per merchant. */
export const cardCategoryRuleSchema = z.object({
  merchantKey: merchantKeySchema,
  categoryId: z.uuid(),
});
export type CardCategoryRule = z.infer<typeof cardCategoryRuleSchema>;

export const cardCategoryRulesResponseSchema = z.object({
  rules: z.array(cardCategoryRuleSchema),
});
export type CardCategoryRulesResponse = z.infer<typeof cardCategoryRulesResponseSchema>;

/** What a merchant keyword points to: names a user's own category may have, then a default key. */
interface SuggestionTarget {
  /** Normalized names of a category the user may have created, most specific first. */
  names: readonly string[];
  /** The default category (`parent.child` or `parent`) when no name matches. */
  defaultKey: string;
}

interface KeywordGroup {
  target: SuggestionTarget;
  /**
   * Normalized keywords. One word of 6 letters or more matches as the start of a word
   * ("mcdonald" matches "mcdonalds"); shorter or multi-word keywords match whole words.
   */
  keywords: readonly string[];
}

const KEYWORD_GROUPS: readonly KeywordGroup[] = [
  {
    target: {
      names: ['auto', 'autos', 'vehiculo', 'vehiculos', 'coche', 'car', 'cars', 'vehicle'],
      defaultKey: 'transport',
    },
    keywords: [
      'chevrolet',
      'ford',
      'fiat',
      'renault',
      'peugeot',
      'toyota',
      'volkswagen',
      'vw',
      'citroen',
      'nissan',
      'honda',
      'jeep',
      'hyundai',
      'autoplan',
      'plan rombo',
      'plan ovalo',
      'circulo cerrado',
      'lubricentro',
      'neumaticos',
      'gomeria',
      'vtv',
      'taller mecanico',
    ],
  },
  {
    target: { names: ['nafta', 'combustible', 'fuel'], defaultKey: 'transport.fuel' },
    keywords: ['ypf', 'shell', 'axion', 'puma energy', 'gulf', 'estacion de servicio'],
  },
  {
    target: { names: ['peajes', 'peaje', 'tolls'], defaultKey: 'transport' },
    keywords: ['peaje', 'telepase', 'ausol', 'autopistas'],
  },
  {
    target: {
      names: ['apps de viaje', 'uber', 'taxi', 'ride hailing'],
      defaultKey: 'transport.ride-hailing',
    },
    keywords: ['uber', 'cabify', 'didi'],
  },
  {
    target: {
      names: ['transporte publico', 'public transport'],
      defaultKey: 'transport.public-transport',
    },
    keywords: ['sube', 'trenes argentinos'],
  },
  {
    target: { names: ['estacionamiento', 'parking'], defaultKey: 'transport.parking' },
    keywords: ['estacionamiento', 'parking'],
  },
  {
    target: { names: ['supermercado', 'super', 'groceries'], defaultKey: 'food.groceries' },
    keywords: [
      'coto',
      'carrefour',
      'jumbo',
      'disco',
      'vea',
      'dia',
      'la anonima',
      'changomas',
      'chango mas',
      'walmart',
      'makro',
      'vital',
      'maxiconsumo',
      'diarco',
      'supermercado',
      'autoservicio',
      'hipermercado',
    ],
  },
  {
    target: { names: ['delivery'], defaultKey: 'food.delivery' },
    keywords: ['pedidosya', 'pedidos ya', 'rappi'],
  },
  {
    target: { names: ['restaurantes', 'restaurants', 'salidas'], defaultKey: 'food.restaurants' },
    keywords: [
      'mcdonald',
      'burger king',
      'starbucks',
      'mostaza',
      'havanna',
      'cafe martinez',
      'restaurant',
      'restaurante',
      'parrilla',
      'cerveceria',
    ],
  },
  {
    target: {
      names: ['streaming', 'suscripciones', 'subscriptions'],
      defaultKey: 'entertainment.streaming',
    },
    keywords: [
      'netflix',
      'spotify',
      'disney',
      'hbo',
      'paramount',
      'prime video',
      'amazon prime',
      'youtube',
      'crunchyroll',
      'deezer',
      'apple com bill',
    ],
  },
  {
    target: { names: ['salidas', 'cine', 'outings'], defaultKey: 'entertainment.outings' },
    keywords: ['cinemark', 'hoyts', 'showcase', 'ticketek', 'passline', 'all access', 'teatro'],
  },
  {
    target: { names: ['hobbies', 'juegos', 'games'], defaultKey: 'entertainment.hobbies' },
    keywords: ['steam', 'playstation', 'xbox', 'nintendo'],
  },
  {
    target: { names: ['gimnasio', 'gym', 'deporte', 'deportes'], defaultKey: 'health' },
    keywords: ['megatlon', 'sportclub', 'smart fit', 'gimnasio'],
  },
  {
    target: { names: ['farmacia', 'pharmacy'], defaultKey: 'health.pharmacy' },
    keywords: ['farmacia', 'farmacity', 'dr ahorro'],
  },
  {
    target: {
      names: ['prepaga', 'obra social', 'health insurance'],
      defaultKey: 'health.health-insurance',
    },
    keywords: ['osde', 'swiss medical', 'galeno', 'medicus', 'omint', 'sancor salud', 'medife'],
  },
  {
    target: { names: ['servicios', 'utilities'], defaultKey: 'home.utilities' },
    keywords: [
      'edenor',
      'edesur',
      'metrogas',
      'naturgy',
      'aysa',
      'camuzzi',
      'ecogas',
      'movistar',
      'claro',
      'telecentro',
      'fibertel',
      'telecom',
      'directv',
    ],
  },
  {
    target: { names: ['mantenimiento', 'maintenance'], defaultKey: 'home.maintenance' },
    keywords: ['easy', 'sodimac', 'blaisten', 'pintureria', 'ferreteria'],
  },
  {
    target: { names: ['ropa', 'clothing'], defaultKey: 'shopping.clothing' },
    keywords: ['zara', 'nike', 'adidas', 'dexter', 'grimoldi', 'kevingston', 'rapsodia', 'cheeky'],
  },
  {
    target: {
      names: ['electronica', 'electronics', 'tecnologia'],
      defaultKey: 'shopping.electronics',
    },
    keywords: ['fravega', 'garbarino', 'musimundo', 'compumundo', 'megatone', 'samsung'],
  },
  {
    target: { names: ['compras', 'shopping'], defaultKey: 'shopping' },
    keywords: ['mercadolibre', 'mercado libre', 'amazon', 'aliexpress', 'shein', 'temu'],
  },
  {
    target: { names: ['educacion', 'education', 'cursos'], defaultKey: 'education' },
    keywords: ['udemy', 'coursera', 'platzi', 'universidad', 'colegio'],
  },
  {
    target: { names: ['impuestos y comisiones', 'impuestos', 'taxes fees'], defaultKey: 'taxes' },
    keywords: ['impuesto', 'percepcion', 'iva', 'sellos', 'iibb', 'comision', 'intereses'],
  },
];

const FEE_TARGET: SuggestionTarget = {
  names: ['impuestos y comisiones', 'impuestos', 'taxes fees'],
  defaultKey: 'taxes',
};

function matchesKeyword(padded: string, keyword: string): boolean {
  if (!keyword.includes(' ') && keyword.length >= 6) return padded.includes(` ${keyword}`);
  return padded.includes(` ${keyword} `);
}

/** The target of the first keyword group that matches the description, if any. */
function keywordTarget(description: string): SuggestionTarget | null {
  const padded = ` ${normalizeMerchantText(description)} `;
  for (const group of KEYWORD_GROUPS) {
    if (group.keywords.some((keyword) => matchesKeyword(padded, keyword))) return group.target;
  }
  return null;
}

/** One of the user's open expense categories, as the suggestion sees it. */
export interface SuggestableCategory {
  id: string;
  /** The default key (`parent.child` or `parent`), or null for a category the user created. */
  key: string | null;
  /** The name shown to the user, in any language. */
  label: string;
}

function resolveTarget(
  target: SuggestionTarget,
  categories: readonly SuggestableCategory[],
): string | null {
  for (const name of target.names) {
    const match = categories.find((category) => normalizeMerchantText(category.label) === name);
    if (match) return match.id;
  }
  const exact = categories.find((category) => category.key === target.defaultKey);
  if (exact) return exact.id;
  const parentKey = target.defaultKey.split('.')[0];
  return categories.find((category) => category.key === parentKey)?.id ?? null;
}

export type CategorySuggestionSource = 'learned' | 'keyword';

export interface CategorySuggestion {
  categoryId: string;
  source: CategorySuggestionSource;
}

/**
 * The category suggested for one statement line: the user's own rule for its merchant first, then
 * the merchant dictionary, then the taxes category for a fee line. `null` when nothing matches or
 * the category it points to is not among `categories` (archived, deleted or not an expense).
 */
export function suggestCategory(
  line: { description: string; kind: 'purchase' | 'fee' | 'payment' },
  rules: ReadonlyMap<string, string>,
  categories: readonly SuggestableCategory[],
): CategorySuggestion | null {
  const open = new Set(categories.map((category) => category.id));
  const key = merchantKey(line.description);
  const learned = key === null ? undefined : rules.get(key);
  if (learned !== undefined && open.has(learned)) return { categoryId: learned, source: 'learned' };

  const target = keywordTarget(line.description) ?? (line.kind === 'fee' ? FEE_TARGET : null);
  if (target === null) return null;
  const categoryId = resolveTarget(target, categories);
  return categoryId === null ? null : { categoryId, source: 'keyword' };
}
