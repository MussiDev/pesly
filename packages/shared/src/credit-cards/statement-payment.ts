import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { movementAmountSchema, movementNoteSchema, occurredAtSchema } from '../movements/movement';

export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * `POST /credit-cards/:id/payments`: a transfer to the card's linked account of `currency`. The
 * destination is chosen by the server, so the request has no destination field (spec D5).
 */
export const createStatementPaymentRequestSchema = z.strictObject({
  currency: accountCurrencySchema,
  sourceAccountId: z.uuid(),
  amount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  note: movementNoteSchema.optional(),
});

export type CreateStatementPaymentRequest = z.infer<typeof createStatementPaymentRequestSchema>;

export const statementPaymentResponseSchema = z.object({
  movementId: z.string(),
  sourceAccountId: z.string(),
  accountId: z.string(),
  currency: accountCurrencySchema,
  amount: z.string(),
  occurredAt: z.iso.datetime(),
});

export type StatementPaymentResponse = z.infer<typeof statementPaymentResponseSchema>;

/** The amount of a closed statement that payments cover in one currency, and its status. */
export const currencyPaymentSchema = z.object({
  paid: exactIntegerStringSchema,
  status: paymentStatusSchema,
});

export type CurrencyPayment = z.infer<typeof currencyPaymentSchema>;

/** Derived on read from the statement total and the transfers received by the card (spec D1). */
export const statementPaymentsSchema = z.object({
  ARS: currencyPaymentSchema,
  USD: currencyPaymentSchema,
});

export type StatementPayments = z.infer<typeof statementPaymentsSchema>;
