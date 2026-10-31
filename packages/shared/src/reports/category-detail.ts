import { z } from 'zod';
import { ACCOUNT_CURRENCIES } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { localDateSchema } from '../movements/movement-filters';

const currencySchema = z.enum(ACCOUNT_CURRENCIES);

/** `GET /reports/category-detail`: one top-level expense category in one month. */
export const categoryDetailQuerySchema = z.strictObject({
  categoryId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type CategoryDetailQuery = z.infer<typeof categoryDetailQuerySchema>;

/**
 * What the month counts for a category, as the dashboard does: a movement by its day, a card
 * purchase and an installment by the month their statement is due, and the caller's share of a
 * group expense instead of the payment.
 */
export const CATEGORY_DETAIL_SOURCES = [
  'movement',
  'cardPurchase',
  'installment',
  'share',
] as const;
export type CategoryDetailSource = (typeof CATEGORY_DETAIL_SOURCES)[number];

export const categoryDetailItemSchema = z.object({
  /** Unique within the response. */
  key: z.string(),
  source: z.enum(CATEGORY_DETAIL_SOURCES),
  /** The movement's or the group expense's day, or the purchase day of an installment. */
  day: localDateSchema,
  /** `YYYY-MM-DD` the statement is due, for a card purchase or an installment. */
  dueDate: localDateSchema.nullable(),
  /** The movement or purchase note, or the group expense description. */
  label: z.string().nullable(),
  /** The item's own category (a subcategory or the category itself); null for a share. */
  category: z
    .object({ id: z.uuid(), name: z.string().nullable(), defaultKey: z.string().nullable() })
    .nullable(),
  currency: currencySchema,
  /** In `currency`. */
  originalAmount: exactIntegerStringSchema,
  /** In the display currency; null when it needs a rate there is not. */
  amount: exactIntegerStringSchema.nullable(),
  /** The movement to open, for a movement or a card purchase. */
  movementId: z.uuid().nullable(),
  /** The card, for an installment. */
  cardId: z.uuid().nullable(),
  installment: z.object({ number: z.number().int(), count: z.number().int() }).nullable(),
  /** The group, for a share. */
  group: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type CategoryDetailItem = z.infer<typeof categoryDetailItemSchema>;

export const categoryDetailResponseSchema = z.object({
  currency: currencySchema,
  month: z.string(),
  categoryId: z.uuid(),
  name: z.string().nullable(),
  defaultKey: z.string().nullable(),
  /** The figure the dashboard shows for the category in the month. */
  total: exactIntegerStringSchema,
  /** Newest first. */
  items: z.array(categoryDetailItemSchema),
  unconvertedShareCount: z.number().int().min(0),
  unconvertedInstallmentCount: z.number().int().min(0),
});
export type CategoryDetailResponse = z.infer<typeof categoryDetailResponseSchema>;
