import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { movementAmountSchema } from '../movements/movement';
import { calendarDateSchema, installmentCountSchema, installmentNumberSchema } from './credit-card';

/** The most lines one statement import carries (a statement is far below it). */
export const STATEMENT_IMPORT_MAX_LINES = 300;
export const STATEMENT_IMPORT_DESCRIPTION_MAX_LENGTH = 200;
export const STATEMENT_IMPORT_VOUCHER_MAX_LENGTH = 40;

/** What an imported line becomes: `payment` lines of a statement are never imported. */
export const STATEMENT_IMPORT_LINE_KINDS = ['purchase', 'fee'] as const;

export const statementImportLineSchema = z
  .strictObject({
    date: calendarDateSchema,
    description: z.string().trim().min(1).max(STATEMENT_IMPORT_DESCRIPTION_MAX_LENGTH),
    voucher: z.string().trim().min(1).max(STATEMENT_IMPORT_VOUCHER_MAX_LENGTH).nullable(),
    currency: accountCurrencySchema,
    /** The amount of this statement's installment (or of the whole purchase), minor units. */
    amount: movementAmountSchema,
    installmentNumber: installmentNumberSchema.nullable(),
    installmentCount: installmentCountSchema.nullable(),
    kind: z.enum(STATEMENT_IMPORT_LINE_KINDS),
  })
  .refine((line) => (line.installmentNumber === null) === (line.installmentCount === null), {
    path: ['installmentCount'],
    message: 'The installment number and count come together',
  })
  .refine(
    (line) =>
      line.installmentNumber === null ||
      (line.installmentCount !== null && line.installmentNumber <= line.installmentCount),
    { path: ['installmentNumber'], message: 'The installment number exceeds the count' },
  )
  .refine((line) => line.kind === 'purchase' || line.installmentCount === null, {
    path: ['kind'],
    message: 'Only a purchase can be paid in installments',
  });

export type StatementImportLine = z.infer<typeof statementImportLineSchema>;

/** `POST /credit-cards/:id/statement-imports`: the lines of one statement, one category for all. */
export const createStatementImportRequestSchema = z
  .strictObject({
    /** The closing date of the imported statement: it picks the statement the lines land on. */
    closingDate: calendarDateSchema,
    /** Its due date; when the card has no such statement yet, it is created with both dates. */
    dueDate: calendarDateSchema.optional(),
    categoryId: z.uuid(),
    lines: z.array(statementImportLineSchema).min(1).max(STATEMENT_IMPORT_MAX_LINES),
  })
  .refine((body) => body.dueDate === undefined || body.dueDate > body.closingDate, {
    path: ['dueDate'],
    message: 'The due date must be after the closing date',
  });

export type CreateStatementImportRequest = z.infer<typeof createStatementImportRequestSchema>;

export const statementImportResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  createdExpenses: z.number().int().nonnegative(),
  createdInstallmentPurchases: z.number().int().nonnegative(),
});

export type StatementImportResponse = z.infer<typeof statementImportResponseSchema>;
