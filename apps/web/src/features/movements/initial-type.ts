import { MOVEMENT_TYPES, type MovementType } from '@pesly/shared';

/**
 * The movement type a link asks the new-movement screen to open on, taken from `?type=`. Only the
 * four exact values pass: anything else, including a repeated parameter, opens on an expense. The
 * raw value is never rendered or put back into a URL.
 */
export function parseInitialType(value: string | string[] | undefined): MovementType {
  if (typeof value !== 'string') return 'expense';
  return MOVEMENT_TYPES.find((type) => type === value) ?? 'expense';
}
