import { z } from 'zod';

export const MOVEMENT_TAG_MAX_LENGTH = 30;
export const MOVEMENT_TAGS_MAX_COUNT = 10;
export const TAG_SUGGESTIONS_MAX_LIMIT = 20;
export const TAG_SUGGESTIONS_DEFAULT_LIMIT = 10;

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * A tag: NFC-normalized, trimmed, 1 to 30 code points, no control or format characters. The control
 * check runs before trimming, as for notes, so a tab or a zero-width space is never silently dropped.
 */
export const movementTagSchema = z.string().transform((raw, ctx) => {
  if (CONTROL_OR_FORMAT_CHARACTER.test(raw)) {
    ctx.addIssue({ code: 'custom', message: 'Tag must not contain control or format characters' });
  }
  const tag = raw.normalize('NFC').trim();
  const length = Array.from(tag).length;
  if (length < 1 || length > MOVEMENT_TAG_MAX_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      message: `Tag must be between 1 and ${MOVEMENT_TAG_MAX_LENGTH} characters`,
    });
  }
  return tag;
});

/**
 * At most 10 entries as submitted (the limit applies before collapsing); entries equal after case
 * folding collapse into the first spelling, keeping the order.
 */
export const movementTagsSchema = z
  .array(movementTagSchema)
  .max(MOVEMENT_TAGS_MAX_COUNT)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** `z.coerce.number()` turns '' and whitespace into 0; a blank query value must fail instead. */
function queryInteger<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );
}

/** `GET /tags`. */
export const tagSuggestionsQuerySchema = z.object({
  prefix: movementTagSchema,
  limit: queryInteger(z.coerce.number().int().min(1).max(TAG_SUGGESTIONS_MAX_LIMIT)).default(
    TAG_SUGGESTIONS_DEFAULT_LIMIT,
  ),
});
export type TagSuggestionsQuery = z.infer<typeof tagSuggestionsQuerySchema>;

export const tagSuggestionsResponseSchema = z.object({
  items: z.array(z.string()),
});
export type TagSuggestionsResponse = z.infer<typeof tagSuggestionsResponseSchema>;
