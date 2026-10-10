import { z } from 'zod';
import { USER_ID_PATTERN } from './user-id';

/** The one thing kept in `localStorage`: who signed in last, so an offline start knows whose copy to open. */
export const SESSION_POINTER_KEY = 'pesly.session';

export interface SessionPointer {
  userId: string;
  emailVerified: boolean;
}

const pointerSchema = z.object({
  userId: z.string().regex(USER_ID_PATTERN),
  emailVerified: z.boolean(),
});

/** `null` when there is no pointer, it does not parse, or the browser blocks `localStorage`. */
export function readSessionPointer(): SessionPointer | null {
  try {
    const raw = localStorage.getItem(SESSION_POINTER_KEY);
    if (raw === null) return null;
    const parsed = pointerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Blocked storage or text that is not JSON: both mean "no pointer", never an error for the app.
    return null;
  }
}

export function writeSessionPointer(pointer: SessionPointer): void {
  try {
    localStorage.setItem(SESSION_POINTER_KEY, JSON.stringify(pointer));
  } catch {
    // Blocked storage: the app works online as before, and an offline start asks for one online visit.
  }
}

export function clearSessionPointer(): void {
  try {
    localStorage.removeItem(SESSION_POINTER_KEY);
  } catch {
    // Nothing to remove when the browser blocks `localStorage`.
  }
}
