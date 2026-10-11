import { z } from 'zod';
import {
  INSTRUMENT_NAME_MAX_LENGTH,
  IMPORT_MAX_HOLDINGS,
  INSTRUMENT_TYPES,
  PORTFOLIO_NAME_MAX_LENGTH,
  PRICE_SOURCES,
  QUANTITY_MAX,
  TICKER_MAX_LENGTH,
  TOTAL_COST_MAX,
  UNIT_PRICE_MAX,
  VALUATION_CURRENCIES,
} from './constants';

/** Integers travel as strings so JSON never carries a float; handlers convert to BigInt. */
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;
const SIGNED_INTEGER = /^(0|-?[1-9][0-9]*)$/;

const unsignedIntegerString = z.string().regex(UNSIGNED_INTEGER);
const signedIntegerString = z.string().regex(SIGNED_INTEGER);

function boundedIntegerString(max: bigint) {
  // Zod 4 runs refinements even after the regex fails, so the guard avoids BigInt throwing.
  return unsignedIntegerString.refine(
    (text) => UNSIGNED_INTEGER.test(text) && BigInt(text) >= 1n && BigInt(text) <= max,
  );
}

const quantitySchema = boundedIntegerString(QUANTITY_MAX);
const totalCostSchema = boundedIntegerString(TOTAL_COST_MAX);
const unitPriceSchema = boundedIntegerString(UNIT_PRICE_MAX);

const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const valuationCurrencySchema = z.enum(VALUATION_CURRENCIES);
const priceSourceSchema = z.enum(PRICE_SOURCES);

const portfolioNameSchema = z.string().trim().min(1).max(PORTFOLIO_NAME_MAX_LENGTH);
const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(TICKER_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const instrumentNameSchema = z.string().trim().min(1).max(INSTRUMENT_NAME_MAX_LENGTH);

export const createPortfolioRequestSchema = z.object({ name: portfolioNameSchema });

export type CreatePortfolioRequest = z.infer<typeof createPortfolioRequestSchema>;

export const addHoldingRequestSchema = z
  .object({
    ticker: tickerSchema,
    instrumentName: instrumentNameSchema,
    instrumentType: instrumentTypeSchema,
    quantity: quantitySchema,
    valuationCurrency: valuationCurrencySchema,
    totalCost: totalCostSchema.optional(),
  })
  .refine((holding) => holding.instrumentType !== 'crypto' || holding.valuationCurrency === 'USD', {
    path: ['valuationCurrency'],
    message: 'Crypto is valued in USD',
  });

export type AddHoldingRequest = z.infer<typeof addHoldingRequestSchema>;

export const updateHoldingRequestSchema = z
  .object({
    quantity: quantitySchema.optional(),
    totalCost: totalCostSchema.nullable().optional(),
    valuationCurrency: valuationCurrencySchema.optional(),
  })
  .refine(
    (update) =>
      update.quantity !== undefined ||
      update.totalCost !== undefined ||
      update.valuationCurrency !== undefined,
    { message: 'At least one field is required' },
  )
  .refine((update) => update.valuationCurrency === undefined || update.totalCost !== undefined, {
    path: ['totalCost'],
    message: 'Changing the currency requires stating the total cost again',
  });

export type UpdateHoldingRequest = z.infer<typeof updateHoldingRequestSchema>;

export const setPriceRequestSchema = z.object({ unitPrice: unitPriceSchema });

export type SetPriceRequest = z.infer<typeof setPriceRequestSchema>;

export const portfolioIdParamsSchema = z.object({ portfolioId: z.uuid() });

export type PortfolioIdParams = z.infer<typeof portfolioIdParamsSchema>;

export const holdingIdParamsSchema = z.object({ holdingId: z.uuid() });

export type HoldingIdParams = z.infer<typeof holdingIdParamsSchema>;

export const holdingResponseSchema = z.object({
  id: z.uuid(),
  portfolioId: z.uuid(),
  ticker: z.string(),
  instrumentName: z.string(),
  instrumentType: instrumentTypeSchema,
  quantity: unsignedIntegerString,
  valuationCurrency: valuationCurrencySchema,
  totalCost: unsignedIntegerString.nullable(),
  unitPrice: unsignedIntegerString.nullable(),
  priceSource: priceSourceSchema.nullable(),
  pricedAt: z.iso.datetime().nullable(),
  priceStale: z.boolean(),
  marketUnitPrice: unsignedIntegerString.nullable(),
  marketPricedAt: z.iso.datetime().nullable(),
  marketPriceDiffers: z.boolean(),
  marketPriceRecent: z.boolean(),
  value: signedIntegerString.nullable(),
  gain: z.object({ amount: signedIntegerString, basisPoints: signedIntegerString }).nullable(),
});

export type HoldingResponse = z.infer<typeof holdingResponseSchema>;

export const portfolioResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  totals: z.array(z.object({ currency: valuationCurrencySchema, value: signedIntegerString })),
  holdingsWithoutPrice: z.number().int().nonnegative(),
  holdings: z.array(holdingResponseSchema),
});

export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

export const portfolioListResponseSchema = z.object({
  portfolios: z.array(portfolioResponseSchema),
});

export type PortfolioListResponse = z.infer<typeof portfolioListResponseSchema>;

export const addHoldingResponseSchema = z.object({
  holding: holdingResponseSchema,
  merged: z.boolean(),
});

export type AddHoldingResponse = z.infer<typeof addHoldingResponseSchema>;

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const calendarDaySchema = z
  .string()
  .regex(CALENDAR_DAY)
  // Zod 4 runs refinements even after the regex fails, and an unparseable date would throw.
  .refine(
    (day) =>
      CALENDAR_DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day,
  );

/** A broker file never carries crypto: it is valued in USD from the automatic prices. */
const importInstrumentTypeSchema = instrumentTypeSchema.exclude(['crypto']);

export const importHoldingSchema = z.object({
  ticker: tickerSchema,
  instrumentName: instrumentNameSchema,
  instrumentType: importInstrumentTypeSchema,
  valuationCurrency: valuationCurrencySchema,
  quantity: quantitySchema,
  totalCost: totalCostSchema.nullable(),
  unitPrice: unitPriceSchema,
  pricedOn: calendarDaySchema,
});

export type ImportHolding = z.infer<typeof importHoldingSchema>;

export const importHoldingsRequestSchema = z.object({
  holdings: z.array(importHoldingSchema).min(1).max(IMPORT_MAX_HOLDINGS),
});

export type ImportHoldingsRequest = z.infer<typeof importHoldingsRequestSchema>;

export const importHoldingsResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  portfolio: portfolioResponseSchema,
});

export type ImportHoldingsResponse = z.infer<typeof importHoldingsResponseSchema>;
