import { z } from 'zod';
import { exactIntegerStringSchema, minorUnitsStringSchema } from '../money';

export const ACCOUNT_TYPES = [
  'cash',
  'bank_account',
  'digital_wallet',
  'credit_card',
  'savings',
] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_CURRENCIES = ['ARS', 'USD'] as const;
export const accountCurrencySchema = z.enum(ACCOUNT_CURRENCIES);
export type AccountCurrency = z.infer<typeof accountCurrencySchema>;

export const ACCOUNT_NAME_MAX_LENGTH = 50;

/** Opening balances stay within plus or minus 10^15 minor units, well below 2^53. */
export const OPENING_BALANCE_LIMIT_MINOR_UNITS = 10n ** 15n;

/** An int64 integer string whose absolute value is at most `OPENING_BALANCE_LIMIT_MINOR_UNITS`. */
export const openingBalanceSchema = minorUnitsStringSchema.pipe(
  z.string().refine(
    (text) => {
      const value = BigInt(text);
      return (value < 0n ? -value : value) <= OPENING_BALANCE_LIMIT_MINOR_UNITS;
    },
    {
      message: `Opening balance must be within plus or minus ${OPENING_BALANCE_LIMIT_MINOR_UNITS} minor units`,
    },
  ),
);

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * NFC-normalized, 1 to `max` code points (an emoji counts as one), with plain spaces trimmed at the
 * edges. Any Unicode control (Cc) or format (Cf) character is refused anywhere in the name, edges
 * included: tabs, newlines, NUL, zero-width characters, the BOM, bidi overrides and the soft
 * hyphen would make names look empty or identical. The check runs before trimming because
 * `trim` would otherwise silently strip a BOM, tab or newline at the edges.
 */
export function boundedNameSchema(max: number) {
  return z.string().transform((raw, ctx) => {
    const normalized = raw.normalize('NFC');
    const name = normalized.trim();
    const length = Array.from(name).length;
    // A name of only invisible characters counts as empty.
    const visible = normalized.replace(/[\p{Cc}\p{Cf}\s]/gu, '');
    if (visible.length < 1 || length > max) {
      ctx.addIssue({ code: 'custom', message: `Name must be 1 to ${max} characters` });
    }
    if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Name must not contain control or format characters',
      });
    }
    return name;
  });
}

export const accountNameSchema = boundedNameSchema(ACCOUNT_NAME_MAX_LENGTH);

/**
 * Whether an account of this type counts toward the available balance by default. Shared by the
 * API (create default, migration backfill rule) and the web create form.
 */
export function defaultIncludeInAvailable(type: AccountType): boolean {
  return type === 'cash' || type === 'bank_account' || type === 'digital_wallet';
}

/**
 * `POST /accounts`. The opening balance is optional (absent is "0") and may be negative. A credit
 * card can never be included in the available balance.
 */
export const createAccountRequestSchema = z
  .object({
    name: accountNameSchema,
    type: accountTypeSchema,
    currency: accountCurrencySchema,
    openingBalance: openingBalanceSchema.default('0'),
    includeInAvailable: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'credit_card' && value.includeInAvailable === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['includeInAvailable'],
        message: 'A credit card cannot be included in the available balance',
      });
    }
  });

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

/** `PUT /accounts/:id/include-in-available`. */
export const setIncludeInAvailableRequestSchema = z.object({
  includeInAvailable: z.boolean(),
});

export type SetIncludeInAvailableRequest = z.infer<typeof setIncludeInAvailableRequestSchema>;

/**
 * `PATCH /accounts/:id`. `type` and `currency` are immutable: declaring them as `never` makes
 * sending either a validation failure instead of silently stripping it.
 */
export const renameAccountRequestSchema = z.object({
  name: accountNameSchema,
  type: z.never().optional(),
  currency: z.never().optional(),
  includeInAvailable: z.never().optional(),
});

export type RenameAccountRequest = z.infer<typeof renameAccountRequestSchema>;

/** `PATCH /accounts/:id/opening-balance`. Same limits and sign rules as at creation. */
export const setOpeningBalanceRequestSchema = z.object({
  openingBalance: openingBalanceSchema,
});

export type SetOpeningBalanceRequest = z.infer<typeof setOpeningBalanceRequestSchema>;

export const accountIdParamsSchema = z.object({
  id: z.uuid(),
});

export type AccountIdParams = z.infer<typeof accountIdParamsSchema>;

export const LIST_ACCOUNTS_MAX_LIMIT = 100;
export const LIST_ACCOUNTS_DEFAULT_LIMIT = 50;

/** `z.coerce.number()` turns '' and whitespace into 0; a blank query value must fail instead. */
function queryInteger<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );
}

export const listAccountsQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: queryInteger(z.coerce.number().int().min(1).max(LIST_ACCOUNTS_MAX_LIMIT)).default(
    LIST_ACCOUNTS_DEFAULT_LIMIT,
  ),
  offset: queryInteger(z.coerce.number().int().min(0)).default(0),
});

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

export const accountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  currency: accountCurrencySchema,
  openingBalance: minorUnitsStringSchema,
  balance: exactIntegerStringSchema,
  includeInAvailable: z.boolean(),
  archived: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const listAccountsResponseSchema = z.object({
  items: z.array(accountResponseSchema),
  availableTotals: z.record(accountCurrencySchema, exactIntegerStringSchema),
  netWorthTotals: z.record(accountCurrencySchema, exactIntegerStringSchema),
  debtTotals: z.record(accountCurrencySchema, exactIntegerStringSchema),
  creditCardCount: z.number().int().min(0),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(LIST_ACCOUNTS_MAX_LIMIT),
  offset: z.number().int().min(0),
});

export type ListAccountsResponse = z.infer<typeof listAccountsResponseSchema>;
