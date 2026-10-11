import { z } from 'zod';
import { groupExpenseResponseSchema } from './expense';
import { settlementResponseSchema } from './settlement';

/**
 * `details` of a 409 `GROUP_RECORD_CONFLICT` (spec D3): the record as the server holds it now, the
 * same body a GET answers. An expense carries `shares` and a settlement carries `legs`, so the two
 * never match the same body.
 */
export const groupRecordConflictSchema = z.object({
  current: z.union([groupExpenseResponseSchema, settlementResponseSchema]),
});

export type GroupRecordConflict = z.infer<typeof groupRecordConflictSchema>;
