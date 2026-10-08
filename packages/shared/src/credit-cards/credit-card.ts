import { z } from 'zod';
import {
  ACCOUNT_NAME_MAX_LENGTH,
  accountCurrencySchema,
  boundedNameSchema,
} from '../accounts/account';
import {
  movementAmountSchema,
  movementNoteSchema,
  movementRateRequestSchema,
  occurredAtSchema,
} from '../movements/movement';
import { exactIntegerStringSchema } from '../money';
import { INSTALLMENTS_MAX, INSTALLMENTS_MIN } from '../money/split-installments';
import { isCalendarDate } from './statement-cycle';
import { statementPaymentsSchema } from './statement-payment';

/** Suffixes of the two linked accounts; their names are "<card name> ARS" and "<card name> USD". */
export const LINKED_ACCOUNT_SUFFIXES = { ARS: ' ARS', USD: ' USD' } as const;

/** Leaves room for the " ARS" or " USD" suffix inside an account name (user decision D3). */
export const CARD_NAME_MAX_LENGTH = ACCOUNT_NAME_MAX_LENGTH - LINKED_ACCOUNT_SUFFIXES.ARS.length;

export const cardNameSchema = boundedNameSchema(CARD_NAME_MAX_LENGTH);

export const dayOfMonthSchema = z.number().int().min(1).max(31);

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, { message: 'Must be a real date in YYYY-MM-DD format' });

export const STATEMENT_STATUSES = ['open', 'closed'] as const;
export const statementStatusSchema = z.enum(STATEMENT_STATUSES);
export type StatementStatus = z.infer<typeof statementStatusSchema>;

const atLeastOne = (value: object): boolean => Object.keys(value).length > 0;

/** `POST /credit-cards`. */
export const createCreditCardRequestSchema = z.strictObject({
  name: cardNameSchema,
  closingDay: dayOfMonthSchema,
  dueDay: dayOfMonthSchema,
});

export type CreateCreditCardRequest = z.infer<typeof createCreditCardRequestSchema>;

/** `PATCH /credit-cards/:id`: only the default days (user decision D4). */
export const updateCreditCardRequestSchema = z
  .strictObject({
    closingDay: dayOfMonthSchema.optional(),
    dueDay: dayOfMonthSchema.optional(),
  })
  .refine(atLeastOne, { message: 'At least one day is required' });

export type UpdateCreditCardRequest = z.infer<typeof updateCreditCardRequestSchema>;

/** `PATCH /credit-cards/:id/statements/:statementId`. */
export const updateStatementRequestSchema = z
  .strictObject({
    closingDate: calendarDateSchema.optional(),
    dueDate: calendarDateSchema.optional(),
  })
  .refine(atLeastOne, { message: 'At least one date is required' });

export type UpdateStatementRequest = z.infer<typeof updateStatementRequestSchema>;

export const creditCardIdParamsSchema = z.object({ id: z.uuid() });

export type CreditCardIdParams = z.infer<typeof creditCardIdParamsSchema>;

export const statementParamsSchema = z.object({ id: z.uuid(), statementId: z.uuid() });

export type StatementParams = z.infer<typeof statementParamsSchema>;

export const creditCardResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  closingDay: dayOfMonthSchema,
  dueDay: dayOfMonthSchema,
  arsAccountId: z.string(),
  usdAccountId: z.string(),
  createdAt: z.iso.datetime(),
});

export type CreditCardResponse = z.infer<typeof creditCardResponseSchema>;

export const listCreditCardsResponseSchema = z.object({
  items: z.array(creditCardResponseSchema),
});

export type ListCreditCardsResponse = z.infer<typeof listCreditCardsResponseSchema>;

/**
 * `POST /credit-cards/:id/expenses`: an expense request without `accountId` (the server picks the
 * card's linked account of `currency`), `type`, `tags` and the device `id`.
 */
export const createCardExpenseRequestSchema = z.strictObject({
  currency: accountCurrencySchema,
  categoryId: z.uuid(),
  amount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  note: movementNoteSchema.optional(),
  rate: movementRateRequestSchema,
});

export type CreateCardExpenseRequest = z.infer<typeof createCardExpenseRequestSchema>;

export const cardExpenseResponseSchema = z.object({
  movementId: z.string(),
  accountId: z.string(),
  currency: accountCurrencySchema,
  amount: z.string(),
  occurredAt: z.iso.datetime(),
  statementId: z.string().nullable(),
});

export type CardExpenseResponse = z.infer<typeof cardExpenseResponseSchema>;

/** Sum of the purchases assigned to a statement, per currency, in minor units; never stored. */
export const statementTotalsSchema = z.record(accountCurrencySchema, exactIntegerStringSchema);

export type StatementTotals = z.infer<typeof statementTotalsSchema>;

export const installmentCountSchema = z.number().int().min(INSTALLMENTS_MIN).max(INSTALLMENTS_MAX);

/** One installment as listed inside a statement (DISC-001-10c FR-06). */
export const installmentNumberSchema = z.number().int().min(1).max(INSTALLMENTS_MAX);

export const statementInstallmentSchema = z.object({
  purchaseId: z.string(),
  number: installmentNumberSchema,
  count: installmentCountSchema,
  amount: z.string(),
  categoryId: z.string(),
});

export type StatementInstallment = z.infer<typeof statementInstallmentSchema>;

export const statementResponseSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  closingDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  status: statementStatusSchema,
  totals: statementTotalsSchema,
  installments: z.array(statementInstallmentSchema),
  /** Paid amount and status per currency; `null` while the statement is open (spec D3). */
  payments: statementPaymentsSchema.nullable(),
});

export type StatementResponse = z.infer<typeof statementResponseSchema>;

export const listStatementsResponseSchema = z.object({
  items: z.array(statementResponseSchema),
});

export type ListStatementsResponse = z.infer<typeof listStatementsResponseSchema>;
