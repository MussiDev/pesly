import { z } from 'zod';
import { defaultCategoryName } from './default-categories';

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export const categoryKindSchema = z.enum(CATEGORY_KINDS);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

/** Keys of Lucide icons; the web maps each key to a component, nothing else reaches the page. */
export const CATEGORY_ICONS = [
  'utensils',
  'car',
  'home',
  'heart-pulse',
  'clapperboard',
  'shopping-bag',
  'graduation-cap',
  'receipt',
  'ellipsis',
  'banknote',
  'laptop',
  'trending-up',
  'gift',
  'wallet',
  'piggy-bank',
  'plane',
  'shirt',
  'book-open',
  'briefcase',
  'coffee',
  'dumbbell',
  'paw-print',
  'baby',
  'wrench',
  'pizza',
  'beer',
  'wine',
  'sandwich',
  'apple',
  'shopping-cart',
  'bus',
  'bike',
  'fuel',
  'train-front',
  'smartphone',
  'wifi',
  'zap',
  'droplets',
  'flame',
  'tv',
  'music',
  'gamepad-2',
  'camera',
  'palette',
  'pill',
  'stethoscope',
  'scissors',
  'sparkles',
  'umbrella',
  'ticket',
  'landmark',
  'credit-card',
  'hand-coins',
  'calculator',
  'hammer',
  'sofa',
  'shield',
  'heart',
  'star',
  'globe',
] as const;
export const categoryLucideIconSchema = z.enum(CATEGORY_ICONS);
export type CategoryLucideIcon = z.infer<typeof categoryLucideIconSchema>;

/**
 * Emojis a category can use instead of a Lucide icon. A curated list rather than any emoji: the
 * stored value is `emoji:<character>`, and nothing outside this list reaches the page.
 */
export const CATEGORY_EMOJIS = [
  '🍕',
  '🍔',
  '🍟',
  '🌮',
  '🍣',
  '🍜',
  '🥗',
  '🍎',
  '🍺',
  '🍷',
  '☕',
  '🍰',
  '🛒',
  '👗',
  '👕',
  '👟',
  '💄',
  '🚗',
  '🚌',
  '🚲',
  '🚆',
  '⛽',
  '🛵',
  '🚕',
  '🏠',
  '💡',
  '🔧',
  '🧹',
  '🪴',
  '🚿',
  '📱',
  '💻',
  '🎮',
  '🎬',
  '🎵',
  '📚',
  '🎓',
  '📷',
  '🎨',
  '⚽',
  '🎫',
  '💊',
  '🩺',
  '🏥',
  '💈',
  '🐶',
  '🐱',
  '👶',
  '🎁',
  '🎂',
  '💰',
  '💵',
  '💳',
  '🏦',
  '📈',
  '🧾',
  '💸',
  '🪙',
  '📦',
  '🔒',
  '⭐',
  '💖',
] as const;
export const EMOJI_ICON_PREFIX = 'emoji:';
export type CategoryEmojiIcon = `${typeof EMOJI_ICON_PREFIX}${(typeof CATEGORY_EMOJIS)[number]}`;

const EMOJI_ICONS: ReadonlySet<string> = new Set(
  CATEGORY_EMOJIS.map((emoji) => `${EMOJI_ICON_PREFIX}${emoji}`),
);

export function isCategoryEmojiIcon(value: string): value is CategoryEmojiIcon {
  return EMOJI_ICONS.has(value);
}

/** The emoji character of an `emoji:` icon value, or `undefined` for anything else. */
export function emojiOfIcon(value: string): string | undefined {
  return isCategoryEmojiIcon(value) ? value.slice(EMOJI_ICON_PREFIX.length) : undefined;
}

export const categoryEmojiIconSchema = z.custom<CategoryEmojiIcon>(
  (value) => typeof value === 'string' && isCategoryEmojiIcon(value),
  { message: 'Invalid emoji icon' },
);

/** A category icon is either a Lucide key or one of the curated emojis. */
export const categoryIconSchema = z.union([categoryLucideIconSchema, categoryEmojiIconSchema]);
export type CategoryIcon = z.infer<typeof categoryIconSchema>;

/** Palette keys; the web maps each key to a theme token. */
export const CATEGORY_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'pink',
  'slate',
] as const;
export const categoryColorSchema = z.enum(CATEGORY_COLORS);
export type CategoryColor = z.infer<typeof categoryColorSchema>;

export const CATEGORY_NAME_MAX_LENGTH = 50;

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * Same rule as account names: NFC-normalized, 1 to 50 code points, plain spaces trimmed at the
 * edges, any Unicode control (Cc) or format (Cf) character refused. The check runs on the
 * normalized string before trimming because `trim` would silently strip a BOM, tab or newline.
 */
export const categoryNameSchema = z.string().transform((raw, ctx) => {
  const normalized = raw.normalize('NFC');
  const name = normalized.trim();
  const length = Array.from(name).length;
  // A name of only invisible characters counts as empty.
  const visible = normalized.replace(/[\p{Cc}\p{Cf}\s]/gu, '');
  if (visible.length < 1 || length > CATEGORY_NAME_MAX_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      message: `Name must be 1 to ${CATEGORY_NAME_MAX_LENGTH} characters`,
    });
  }
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Name must not contain control or format characters',
    });
  }
  return name;
});

/** `POST /categories`. `parentId` is absent for a top-level category. */
export const createCategoryRequestSchema = z.object({
  name: categoryNameSchema,
  kind: categoryKindSchema,
  icon: categoryIconSchema,
  color: categoryColorSchema,
  parentId: z.uuid().optional(),
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

/**
 * `PATCH /categories/:id`. `kind` and `parentId` are immutable: declaring them as `never` makes
 * sending either a validation failure instead of silently stripping it.
 */
export const updateCategoryRequestSchema = z
  .object({
    name: categoryNameSchema.optional(),
    icon: categoryIconSchema.optional(),
    color: categoryColorSchema.optional(),
    kind: z.never().optional(),
    parentId: z.never().optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.icon !== undefined || body.color !== undefined,
    { message: 'At least one of name, icon or color is required' },
  );

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const categoryIdParamsSchema = z.object({
  id: z.uuid(),
});

export type CategoryIdParams = z.infer<typeof categoryIdParamsSchema>;

export const LIST_CATEGORIES_MAX_LIMIT = 100;
export const LIST_CATEGORIES_DEFAULT_LIMIT = 100;

/** `z.coerce.number()` turns '' and whitespace into 0; a blank query value must fail instead. */
function queryInteger<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );
}

export const listCategoriesQuerySchema = z.object({
  kind: categoryKindSchema.optional(),
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: queryInteger(z.coerce.number().int().min(1).max(LIST_CATEGORIES_MAX_LIMIT)).default(
    LIST_CATEGORIES_DEFAULT_LIMIT,
  ),
  offset: queryInteger(z.coerce.number().int().min(0)).default(0),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

/** `key` is set for defaults (kept after a rename); `name` is null while a default is untouched. */
export const categoryResponseSchema = z.object({
  id: z.string(),
  kind: categoryKindSchema,
  parentId: z.string().nullable(),
  key: z.string().nullable(),
  name: z.string().nullable(),
  icon: categoryIconSchema,
  color: categoryColorSchema,
  archived: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type CategoryResponse = z.infer<typeof categoryResponseSchema>;

export const listCategoriesResponseSchema = z.object({
  items: z.array(categoryResponseSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(LIST_CATEGORIES_MAX_LIMIT),
  offset: z.number().int().min(0),
});

export type ListCategoriesResponse = z.infer<typeof listCategoriesResponseSchema>;

export type CategoryLanguage = 'es' | 'en';

/** The name the user sees: their own name when set, else the default name of the key. */
export function displayCategoryName(
  category: { key: string | null; name: string | null },
  language: CategoryLanguage,
): string {
  if (category.name !== null) return category.name;
  if (category.key === null) {
    throw new Error('A category without a name must have a default key');
  }
  return defaultCategoryName(category.key, language);
}
