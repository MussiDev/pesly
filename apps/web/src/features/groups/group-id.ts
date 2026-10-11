import { z } from 'zod';

const groupIdSchema = z.uuid();

/** Anything but a UUID is no group of the user, so the screens skip the request and show not-found. */
export function isGroupId(value: string): boolean {
  return groupIdSchema.safeParse(value).success;
}
