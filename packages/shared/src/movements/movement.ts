import { z } from 'zod';
import { LIST_ACCOUNTS_DEFAULT_LIMIT, LIST_ACCOUNTS_MAX_LIMIT } from '../accounts/account';
import { scaledRateStringSchema } from '../exchange-rates/exchange-rate';
import { rateTypeSchema } from '../rate-types';
import { movementFilterShape } from './movement-filters';
import { movementTagsSchema } from './tag';

export const MOVEMENT_TYPES = ['expense', 'income', 'transfer', 'exchange'] as const;
export const movementTypeSchema = z.enum(MOVEMENT_TYPES);
export type MovementType = z.infer<typeof movementTypeSchema>;

/** The types that carry a category (and so a category kind). */
export const CATEGORIZED_MOVEMENT_TYPES = ['expense', 'income'] as const;
export const categorizedMovementTypeSchema = z.enum(CATEGORIZED_MOVEMENT_TYPES);
export type CategorizedMovementType = z.infer<typeof categorizedMovementTypeSchema>;

export const MOVEMENT_RATE_SOURCES = ['automatic', 'manual', 'implied'] as const;
export const movementRateSourceSchema = z.enum(MOVEMENT_RATE_SOURCES);
export type MovementRateSource = z.infer<typeof movementRateSourceSchema>;

/** Same bound as the opening balance of an account: well below 2^53 and the int64 range. */
export const MOVEMENT_AMOUNT_MAX_MINOR_UNITS = 10n ** 15n;
export const MOVEMENT_NOTE_MAX_LENGTH = 500;

/** A positive minor-units integer string, 1..10^15, with no leading zeros. */
export const movementAmountSchema = z
  .string()
  .regex(/^[1-9]\d{0,15}$/, 'Amount must be a positive integer string')
  .pipe(
    z.string().refine((text) => BigInt(text) <= MOVEMENT_AMOUNT_MAX_MINOR_UNITS, {
      message: `Amount must not exceed ${MOVEMENT_AMOUNT_MAX_MINOR_UNITS} minor units`,
    }),
  );

const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

/** An ISO 8601 UTC instant (`...Z`), a real calendar instant, year 1970 to 2100. */
export const occurredAtSchema = z.iso.datetime().refine(
  (text) => {
    const year = Number.parseInt(text.slice(0, 4), 10);
    return year >= YEAR_MIN && year <= YEAR_MAX;
  },
  { message: `Date must be between ${YEAR_MIN} and ${YEAR_MAX}` },
);

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * Trimmed note of at most 500 code points, no control or format characters. A note that is empty
 * after trimming becomes `undefined`. The control check runs before trimming, as for account names.
 */
export const movementNoteSchema = z.string().transform((raw, ctx) => {
  if (CONTROL_OR_FORMAT_CHARACTER.test(raw)) {
    ctx.addIssue({ code: 'custom', message: 'Note must not contain control or format characters' });
  }
  const note = raw.normalize('NFC').trim();
  if (Array.from(note).length > MOVEMENT_NOTE_MAX_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      message: `Note must be at most ${MOVEMENT_NOTE_MAX_LENGTH} characters`,
    });
  }
  return note === '' ? undefined : note;
});

export const movementRateRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('automatic') }),
  z.object({ source: z.literal('manual'), value: scaledRateStringSchema }),
]);
export type MovementRateRequest = z.infer<typeof movementRateRequestSchema>;

const createCategorizedMovementSchema = z.object({
  type: categorizedMovementTypeSchema,
  accountId: z.uuid(),
  categoryId: z.uuid(),
  amount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  note: movementNoteSchema.optional(),
  tags: movementTagsSchema.optional(),
  rate: movementRateRequestSchema,
});

const createTransferSchema = z.object({
  type: z.literal('transfer'),
  accountId: z.uuid(),
  destinationAccountId: z.uuid(),
  amount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  note: movementNoteSchema.optional(),
});

/** `accountId` is the source; `amount` leaves it and `destinationAmount` enters the destination. */
const createExchangeSchema = z.object({
  type: z.literal('exchange'),
  accountId: z.uuid(),
  destinationAccountId: z.uuid(),
  amount: movementAmountSchema,
  destinationAmount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  note: movementNoteSchema.optional(),
});

/**
 * The identifier a device picks before it knows whether it is online. Only a creation takes it: an
 * edit names its movement in the path, so the update schemas leave it out and strip it.
 */
const deviceIdField = { id: z.uuid().optional() };

/**
 * `POST /movements`, discriminated on `type`. For expense and income the client picks the rate
 * source and the automatic value is resolved on the server; transfers and exchanges carry no
 * category and no rate (an exchange's rate is implied by its two amounts). Foreign keys are stripped.
 * An optional `id` makes the creation idempotent: the same owner sending it again gets the stored
 * movement back instead of a second row.
 */
export const createMovementRequestSchema = z.discriminatedUnion('type', [
  createCategorizedMovementSchema.extend({ type: z.literal('expense'), ...deviceIdField }),
  createCategorizedMovementSchema.extend({ type: z.literal('income'), ...deviceIdField }),
  createTransferSchema.extend(deviceIdField),
  createExchangeSchema.extend(deviceIdField),
]);
export type CreateMovementRequest = z.infer<typeof createMovementRequestSchema>;

/**
 * What an edit may do with the rate of an expense or income: `keep` leaves the stored rate, its
 * source and its rate type untouched; `automatic` and `manual` freeze a new one.
 */
export const movementRateUpdateSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('keep') }),
  z.object({ source: z.literal('automatic') }),
  z.object({ source: z.literal('manual'), value: scaledRateStringSchema }),
]);
export type MovementRateUpdate = z.infer<typeof movementRateUpdateSchema>;

const updateCategorizedMovementSchema = createCategorizedMovementSchema.extend({
  rate: movementRateUpdateSchema,
});

/**
 * `PUT /movements/:id`: a full replacement with the shape of a creation, so an omitted note or tags
 * clears them. The type must match the stored one. Only the rate of an expense or income differs
 * from `createMovementRequestSchema` (it may be `keep`).
 */
export const updateMovementRequestSchema = z.discriminatedUnion('type', [
  updateCategorizedMovementSchema.extend({ type: z.literal('expense') }),
  updateCategorizedMovementSchema.extend({ type: z.literal('income') }),
  createTransferSchema,
  createExchangeSchema,
]);
export type UpdateMovementRequest = z.infer<typeof updateMovementRequestSchema>;

export const movementIdParamsSchema = z.object({
  id: z.uuid(),
});
export type MovementIdParams = z.infer<typeof movementIdParamsSchema>;

export const LIST_MOVEMENTS_MAX_LIMIT = LIST_ACCOUNTS_MAX_LIMIT;
export const LIST_MOVEMENTS_DEFAULT_LIMIT = LIST_ACCOUNTS_DEFAULT_LIMIT;

/** `z.coerce.number()` turns '' and whitespace into 0; a blank query value must fail instead. */
function queryInteger<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );
}

export const listMovementsQuerySchema = z
  .object({
    limit: queryInteger(z.coerce.number().int().min(1).max(LIST_MOVEMENTS_MAX_LIMIT)).default(
      LIST_MOVEMENTS_DEFAULT_LIMIT,
    ),
    offset: queryInteger(z.coerce.number().int().min(0)).default(0),
  })
  .extend(movementFilterShape)
  // A refinement placed before `.extend` would not compose, so it goes last.
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ['from'],
    message: 'from must not be later than to',
  });
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const movementResponseSchema = z.object({
  id: z.string(),
  type: movementTypeSchema,
  accountId: z.string(),
  categoryId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  amount: movementAmountSchema,
  destinationAmount: movementAmountSchema.nullable(),
  occurredAt: z.iso.datetime(),
  note: z.string().nullable(),
  rate: scaledRateStringSchema.nullable(),
  rateSource: movementRateSourceSchema.nullable(),
  rateType: rateTypeSchema.nullable(),
  createdAt: z.iso.datetime(),
  tags: z.array(z.string()),
});
export type MovementResponse = z.infer<typeof movementResponseSchema>;

export const listMovementsResponseSchema = z.object({
  items: z.array(movementResponseSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(LIST_MOVEMENTS_MAX_LIMIT),
  offset: z.number().int().min(0),
});
export type ListMovementsResponse = z.infer<typeof listMovementsResponseSchema>;
