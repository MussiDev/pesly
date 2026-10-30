import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { categorizedMovementTypeSchema } from './movement';
import { movementFilterShape } from './movement-filters';

/** `GET /movements/summary`: the filters of `GET /movements`, without paging. */
export const movementSummaryQuerySchema = z
  .object(movementFilterShape)
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ['from'],
    message: 'from must not be later than to',
  });
export type MovementSummaryQuery = z.infer<typeof movementSummaryQuerySchema>;

/**
 * The sum of the matching expenses or incomes of one category in one account currency. Transfers,
 * exchanges and adjustments are not spending, so they never have a row.
 */
export const movementSummaryRowSchema = z.object({
  categoryId: z.uuid().nullable(),
  currency: accountCurrencySchema,
  type: categorizedMovementTypeSchema,
  amount: exactIntegerStringSchema,
  count: z.number().int().min(1),
});
export type MovementSummaryRow = z.infer<typeof movementSummaryRowSchema>;

export const movementSummaryResponseSchema = z.object({
  rows: z.array(movementSummaryRowSchema),
});
export type MovementSummaryResponse = z.infer<typeof movementSummaryResponseSchema>;
