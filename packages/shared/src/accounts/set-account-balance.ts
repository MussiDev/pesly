import { z } from 'zod';
import { secondFactorCodeSchema } from '../auth/two-factor';
import { movementNoteSchema, movementResponseSchema } from '../movements/movement';
import { accountResponseSchema, openingBalanceSchema } from './account';

/**
 * `POST /accounts/:id/balance`: the balance the account should have now. The server records the
 * difference as an adjustment. `secondFactorCode` is required only when the user has 2FA on.
 * Lives apart from `account.ts` because `movement.ts` already imports that file.
 */
export const setAccountBalanceRequestSchema = z.object({
  balance: openingBalanceSchema,
  note: movementNoteSchema.optional(),
  secondFactorCode: secondFactorCodeSchema.optional(),
});

export type SetAccountBalanceRequest = z.infer<typeof setAccountBalanceRequestSchema>;

/** `adjustment` is `null` when the target already equals the current balance. */
export const setAccountBalanceResponseSchema = z.object({
  account: accountResponseSchema,
  adjustment: movementResponseSchema.nullable(),
});

export type SetAccountBalanceResponse = z.infer<typeof setAccountBalanceResponseSchema>;
