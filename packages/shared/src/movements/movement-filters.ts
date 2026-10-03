import { z } from 'zod';
import { movementTagSchema } from './tag';

const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

/** A real local calendar day, `YYYY-MM-DD`, year 1970 to 2100. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine(
    (text) => {
      const year = Number.parseInt(text.slice(0, 4), 10);
      const month = Number.parseInt(text.slice(5, 7), 10);
      const day = Number.parseInt(text.slice(8, 10), 10);
      if (year < YEAR_MIN || year > YEAR_MAX) return false;
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: `Date must be a real day between ${YEAR_MIN} and ${YEAR_MAX}` },
  );

/**
 * Declared here, not imported from `movement.ts`, because `movement.ts` extends its list query with
 * this shape and an import back would be circular. A probe test fails when `MOVEMENT_TYPES` holds a
 * value this list does not accept.
 */
const FILTER_MOVEMENT_TYPES = ['expense', 'income', 'transfer', 'exchange'] as const;

/** The optional filter fields of `GET /movements`; all are absent by default. */
export const movementFilterShape = {
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  type: z.enum(FILTER_MOVEMENT_TYPES).optional(),
  tag: movementTagSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
};
