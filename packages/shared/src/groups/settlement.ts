import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { scaledRateStringSchema } from '../exchange-rates/exchange-rate';
import { exactIntegerStringSchema, minorUnitsStringSchema } from '../money';
import { movementAmountSchema, occurredAtSchema } from '../movements/movement';
import { rateTypeSchema } from '../rate-types';
import { GROUP_EXPENSES_PAGE_SIZE_DEFAULT, GROUP_EXPENSES_PAGE_SIZE_MAX } from './expense';

export const GROUP_SETTLEMENTS_PAGE_SIZE_DEFAULT = GROUP_EXPENSES_PAGE_SIZE_DEFAULT;
export const GROUP_SETTLEMENTS_PAGE_SIZE_MAX = GROUP_EXPENSES_PAGE_SIZE_MAX;

export const SETTLEMENT_RATE_SOURCES = ['automatic', 'manual'] as const;
export const settlementRateSourceSchema = z.enum(SETTLEMENT_RATE_SOURCES);
export type SettlementRateSource = z.infer<typeof settlementRateSourceSchema>;

/** A signed minor-units string that is not zero: a leg that clears nothing is not a leg. */
const nonZeroLegSchema = minorUnitsStringSchema.refine((text) => text !== '0' && text !== '-0', {
  message: 'A leg cannot be zero',
});

const legsSchema = z.strictObject({ ARS: nonZeroLegSchema, USD: nonZeroLegSchema });

export type SettlementLegs = z.infer<typeof legsSchema>;

const singleSettlementSchema = z
  .strictObject({
    kind: z.literal('single'),
    fromMemberId: z.uuid(),
    toMemberId: z.uuid(),
    currency: accountCurrencySchema,
    amount: movementAmountSchema,
    occurredAt: occurredAtSchema,
    accountId: z.uuid().optional(),
  })
  .refine((request) => request.fromMemberId !== request.toMemberId, {
    message: 'The two sides of a payment must be different members',
    path: ['toMemberId'],
  });

const consolidatedSettlementSchema = z.strictObject({
  kind: z.literal('consolidated'),
  memberIds: z
    .array(z.uuid())
    .length(2)
    .refine(([first, second]) => first !== second, {
      message: 'A consolidated settlement needs two different members',
    }),
  currency: accountCurrencySchema,
  occurredAt: occurredAtSchema,
  accountId: z.uuid().optional(),
  rate: scaledRateStringSchema.optional(),
  legs: legsSchema,
});

/**
 * `POST /groups/:id/settlements` (spec D4, D6, D8). That members are active, the account is the
 * caller's and the legs are still current are checked by the use case, not here.
 */
export const createSettlementRequestSchema = z.discriminatedUnion('kind', [
  singleSettlementSchema,
  consolidatedSettlementSchema,
]);

export type CreateSettlementRequest = z.infer<typeof createSettlementRequestSchema>;

/** `GET /groups/:id/settlements/consolidation`. */
export const consolidationQuerySchema = z
  .strictObject({
    memberA: z.uuid(),
    memberB: z.uuid(),
    currency: accountCurrencySchema,
  })
  .refine((query) => query.memberA !== query.memberB, {
    message: 'A consolidation needs two different members',
    path: ['memberB'],
  });

export type ConsolidationQuery = z.infer<typeof consolidationQuerySchema>;

/** The legs relative to memberA to memberB, the group's default rate type and its stored rate. */
export const consolidationPreviewSchema = z.object({
  legs: z.object({ ARS: exactIntegerStringSchema, USD: exactIntegerStringSchema }),
  defaultRateType: rateTypeSchema,
  rate: scaledRateStringSchema.nullable(),
});

export type ConsolidationPreview = z.infer<typeof consolidationPreviewSchema>;

const pageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(GROUP_SETTLEMENTS_PAGE_SIZE_MAX)
  .optional();

/** `GET /groups/:id/settlements`; `limit` defaults to 50 where it is applied. */
export const listSettlementsQuerySchema = z.strictObject({
  limit: pageLimitSchema,
  cursor: z.string().min(1).max(512).optional(),
});

export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;

export const balanceMemberResponseSchema = z.object({
  memberId: z.string(),
  balance: exactIntegerStringSchema,
});

export const settlementPaymentResponseSchema = z.object({
  fromMemberId: z.string(),
  toMemberId: z.string(),
  amount: exactIntegerStringSchema,
});

export const currencyBalancesResponseSchema = z.object({
  members: z.array(balanceMemberResponseSchema),
  payments: z.array(settlementPaymentResponseSchema),
});

export type CurrencyBalancesResponse = z.infer<typeof currencyBalancesResponseSchema>;

/** `GET /groups/:id/balances`: one block per currency, never mixed (spec D1, D16). */
export const balancesResponseSchema = z.object({
  ARS: currencyBalancesResponseSchema,
  USD: currencyBalancesResponseSchema,
});

export type BalancesResponse = z.infer<typeof balancesResponseSchema>;

export const settlementLegResponseSchema = z.object({
  currency: accountCurrencySchema,
  amount: minorUnitsStringSchema,
});

export const settlementResponseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  fromMemberId: z.string(),
  toMemberId: z.string(),
  currency: accountCurrencySchema,
  /** The cash that moves from `from` to `to`; 0 only for a consolidated settlement. */
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  legs: z.array(settlementLegResponseSchema),
  occurredAt: z.iso.datetime(),
  createdByMemberId: z.string(),
  accountId: z.string().nullable(),
  rate: scaledRateStringSchema.nullable(),
  rateSource: settlementRateSourceSchema.nullable(),
  rateType: rateTypeSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type SettlementResponse = z.infer<typeof settlementResponseSchema>;

export const settlementPageSchema = z.object({
  items: z.array(settlementResponseSchema),
  nextCursor: z.string().nullable(),
});

export type SettlementPage = z.infer<typeof settlementPageSchema>;
