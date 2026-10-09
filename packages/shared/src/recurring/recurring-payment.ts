import { z } from 'zod';
import { boundedNameSchema } from '../accounts/account';
import { calendarDateSchema } from '../credit-cards/credit-card';
import { movementAmountSchema } from '../movements/movement';

export const RECURRING_NAME_MAX_LENGTH = 80;

export const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;
export const frequencySchema = z.enum(RECURRING_FREQUENCIES);
export type RecurringFrequencyValue = z.infer<typeof frequencySchema>;

export const RECURRING_MODES = ['automatic', 'confirmation'] as const;
export const modeSchema = z.enum(RECURRING_MODES);
export type RecurringMode = z.infer<typeof modeSchema>;

export const RECURRING_STATUSES = ['active', 'paused'] as const;
export const recurringStatusSchema = z.enum(RECURRING_STATUSES);
export type RecurringStatus = z.infer<typeof recurringStatusSchema>;

export const UPCOMING_KINDS = ['pending', 'overdue', 'scheduled'] as const;
export const upcomingKindSchema = z.enum(UPCOMING_KINDS);
export type UpcomingKind = z.infer<typeof upcomingKindSchema>;

const weekdaySchema = z.number().int().min(0).max(6);
const dayOfMonthSchema = z.number().int().min(1).max(31);
const monthSchema = z.number().int().min(1).max(12);

const recurringFieldsSchema = z.strictObject({
  name: boundedNameSchema(RECURRING_NAME_MAX_LENGTH),
  amount: movementAmountSchema,
  accountId: z.uuid(),
  categoryId: z.uuid(),
  frequency: frequencySchema,
  weekday: weekdaySchema.optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  month: monthSchema.optional(),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema.optional(),
  mode: modeSchema,
});

interface ScheduleFields {
  frequency?: RecurringFrequencyValue | undefined;
  weekday?: number | undefined;
  dayOfMonth?: number | undefined;
  month?: number | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

function checkSchedule(value: ScheduleFields, ctx: z.RefinementCtx, requireAll: boolean): void {
  const fail = (path: string, message: string): void => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  const { frequency } = value;
  if (frequency !== undefined) {
    const uses = {
      weekday: frequency === 'weekly',
      dayOfMonth: frequency === 'monthly' || frequency === 'yearly',
      month: frequency === 'yearly',
    };
    for (const field of ['weekday', 'dayOfMonth', 'month'] as const) {
      if (value[field] !== undefined && !uses[field]) {
        fail(field, `Not allowed for a ${frequency} payment`);
      } else if (requireAll && value[field] === undefined && uses[field]) {
        fail(field, `Required for a ${frequency} payment`);
      }
    }
  }
  if (
    value.startDate !== undefined &&
    value.endDate !== undefined &&
    value.endDate < value.startDate
  ) {
    fail('endDate', 'Must not be before the start date');
  }
}

/** `POST /recurring/payments`. */
export const createRecurringPaymentSchema = recurringFieldsSchema.superRefine((value, ctx) => {
  checkSchedule(value, ctx, true);
});

export type CreateRecurringPayment = z.infer<typeof createRecurringPaymentSchema>;

/** `PATCH /recurring/payments/:id`: every field optional, at least one present. */
export const updateRecurringPaymentSchema = recurringFieldsSchema
  .partial()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one field is required' });
    }
    checkSchedule(value, ctx, false);
  });

export type UpdateRecurringPayment = z.infer<typeof updateRecurringPaymentSchema>;

export const recurringPaymentIdParamsSchema = z.object({ id: z.uuid() });
export type RecurringPaymentIdParams = z.infer<typeof recurringPaymentIdParamsSchema>;

export const occurrenceParamsSchema = z.object({ id: z.uuid() });
export type OccurrenceParams = z.infer<typeof occurrenceParamsSchema>;

export const recurringPaymentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.string(),
  accountId: z.string(),
  categoryId: z.string(),
  frequency: frequencySchema,
  weekday: weekdaySchema.nullable(),
  dayOfMonth: dayOfMonthSchema.nullable(),
  month: monthSchema.nullable(),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema.nullable(),
  mode: modeSchema,
  status: recurringStatusSchema,
  nextDueDate: calendarDateSchema.nullable(),
});

export type RecurringPaymentResponse = z.infer<typeof recurringPaymentResponseSchema>;

export const listRecurringPaymentsResponseSchema = z.object({
  items: z.array(recurringPaymentResponseSchema),
});

export type ListRecurringPaymentsResponse = z.infer<typeof listRecurringPaymentsResponseSchema>;

export const upcomingItemSchema = z.object({
  kind: upcomingKindSchema,
  dueDate: calendarDateSchema,
  paymentId: z.string(),
  name: z.string(),
  amount: z.string(),
  accountId: z.string(),
  categoryId: z.string(),
  /** Set for pending and overdue items, `null` for scheduled ones. */
  occurrenceId: z.string().nullable(),
});

export type UpcomingItem = z.infer<typeof upcomingItemSchema>;

export const upcomingResponseSchema = z.object({ items: z.array(upcomingItemSchema) });

export type UpcomingResponse = z.infer<typeof upcomingResponseSchema>;

/** `POST /recurring/occurrences/:id/confirm`. */
export const confirmOccurrenceSchema = z.strictObject({
  amount: movementAmountSchema.optional(),
  date: calendarDateSchema.optional(),
});

export type ConfirmOccurrence = z.infer<typeof confirmOccurrenceSchema>;
