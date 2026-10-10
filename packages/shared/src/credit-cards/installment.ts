import { z } from 'zod';
import { exactIntegerStringSchema } from '../money';
import { movementAmountSchema, movementNoteSchema } from '../movements/movement';
import {
  calendarDateSchema,
  installmentCountSchema,
  installmentNumberSchema,
  statementStatusSchema,
} from './credit-card';

export const installmentCurrencySchema = z.enum(['ARS', 'USD']);

export type InstallmentCurrency = z.infer<typeof installmentCurrencySchema>;

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** `POST /credit-cards/:id/installment-purchases`: ARS or USD, 2 to 60 installments (FR-01). */
export const createInstallmentPurchaseRequestSchema = z
  .strictObject({
    currency: installmentCurrencySchema,
    categoryId: z.uuid(),
    amount: movementAmountSchema,
    installments: installmentCountSchema,
    purchasedOn: calendarDateSchema,
    note: movementNoteSchema.optional(),
  })
  .refine(
    (body) => !/^[1-9]\d*$/.test(body.amount) || BigInt(body.amount) >= BigInt(body.installments),
    {
      path: ['amount'],
      message: 'The amount must be at least one minor unit per installment',
    },
  );

export type CreateInstallmentPurchaseRequest = z.infer<
  typeof createInstallmentPurchaseRequestSchema
>;

/** `PATCH .../installment-purchases/:purchaseId`: category and note only; `null` clears the note. */
export const updateInstallmentPurchaseRequestSchema = z
  .strictObject({
    categoryId: z.uuid().optional(),
    note: z.union([z.null(), movementNoteSchema.transform((note) => note ?? null)]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type UpdateInstallmentPurchaseRequest = z.infer<
  typeof updateInstallmentPurchaseRequestSchema
>;

export const installmentPurchaseParamsSchema = z.object({ id: z.uuid(), purchaseId: z.uuid() });

export type InstallmentPurchaseParams = z.infer<typeof installmentPurchaseParamsSchema>;

export const installmentSchema = z.object({
  number: installmentNumberSchema,
  amount: z.string(),
  period: periodSchema,
  closingDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  status: statementStatusSchema,
});

export const installmentPurchaseResponseSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  categoryId: z.string(),
  amount: z.string(),
  currency: installmentCurrencySchema,
  installmentCount: installmentCountSchema,
  purchasedOn: calendarDateSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  installments: z.array(installmentSchema),
});

export type InstallmentPurchaseResponse = z.infer<typeof installmentPurchaseResponseSchema>;

/** Pending debt of a card per currency, minor units: installments in statements not yet closed (FR-07). */
export const pendingDebtSchema = z.record(installmentCurrencySchema, exactIntegerStringSchema);

export const listInstallmentPurchasesResponseSchema = z.object({
  items: z.array(installmentPurchaseResponseSchema),
  pendingDebt: pendingDebtSchema,
});

export type ListInstallmentPurchasesResponse = z.infer<
  typeof listInstallmentPurchasesResponseSchema
>;

export const INSTALLMENT_EXPENSES_MAX_MONTHS = 60;

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

/** `GET /credit-cards/installment-expenses?from=YYYY-MM&to=YYYY-MM` (FR-05). */
export const installmentExpensesQuerySchema = z
  .object({ from: monthSchema, to: monthSchema })
  .refine((query) => monthIndex(query.from) <= monthIndex(query.to), {
    path: ['to'],
    message: 'The end month must not be before the start month',
  })
  .refine(
    (query) => monthIndex(query.to) - monthIndex(query.from) < INSTALLMENT_EXPENSES_MAX_MONTHS,
    {
      path: ['to'],
      message: `The range must cover at most ${INSTALLMENT_EXPENSES_MAX_MONTHS} months`,
    },
  );

export type InstallmentExpensesQuery = z.infer<typeof installmentExpensesQuerySchema>;

export const installmentExpensesResponseSchema = z.object({
  items: z.array(
    z.object({
      month: monthSchema,
      categoryId: z.string(),
      currency: installmentCurrencySchema,
      amount: z.string(),
    }),
  ),
});

export type InstallmentExpensesResponse = z.infer<typeof installmentExpensesResponseSchema>;
