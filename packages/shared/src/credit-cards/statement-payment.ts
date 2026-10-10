import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { scaledRateStringSchema } from '../exchange-rates/exchange-rate';
import { exactIntegerStringSchema } from '../money';
import { movementAmountSchema, movementNoteSchema, occurredAtSchema } from '../movements/movement';

export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * `POST /credit-cards/:id/payments`: a transfer to the card's linked account of `currency`. The
 * destination is chosen by the server, so the request has no destination field (spec D5).
 *
 * `amount` is what the card receives (what reduces the balance of `currency`). A USD payment from
 * an ARS account is a currency exchange: it then carries EITHER `pesosAmount` (the pesos debited)
 * OR `rate` (ARS per USD scaled by 10,000), never both. Whether the source is an ARS account is
 * known to the server only, which refuses the missing pair and the superfluous one.
 */
export const createStatementPaymentRequestSchema = z
  .strictObject({
    currency: accountCurrencySchema,
    sourceAccountId: z.uuid(),
    amount: movementAmountSchema,
    pesosAmount: movementAmountSchema.optional(),
    rate: scaledRateStringSchema.optional(),
    occurredAt: occurredAtSchema,
    note: movementNoteSchema.optional(),
  })
  .superRefine((request, ctx) => {
    if (request.pesosAmount !== undefined && request.rate !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rate'],
        message: 'Send the pesos amount or the rate, not both',
      });
    }
    if (request.currency === 'ARS') {
      for (const key of ['pesosAmount', 'rate'] as const) {
        if (request[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Only a USD payment can carry a pesos amount or a rate',
          });
        }
      }
    }
  });

export type CreateStatementPaymentRequest = z.infer<typeof createStatementPaymentRequestSchema>;

export const statementPaymentResponseSchema = z.object({
  movementId: z.string(),
  sourceAccountId: z.string(),
  accountId: z.string(),
  currency: accountCurrencySchema,
  amount: z.string(),
  /** Set when the payment was a currency exchange from an ARS account: pesos debited and the frozen rate. */
  exchange: z.object({ pesosAmount: z.string(), rate: z.string() }).nullable(),
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
