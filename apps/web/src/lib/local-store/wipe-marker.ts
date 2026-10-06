import { z } from 'zod';
import { USER_ID_PATTERN } from './user-id';

/**
 * The users whose local data is being wiped. Written before the wipe starts and removed only when
 * the API confirms that user again, so an interrupted wipe is finished on the next start and no
 * code reopens the database in between.
 */
export const WIPE_MARKER_KEY = 'pesly.wipe';

const MAX_ENTRIES = 20;

const markerSchema = z.array(z.unknown());
const userIdSchema = z.string().regex(USER_ID_PATTERN);

/** The valid ids of the marker; `[]` when it is missing, does not parse or storage is blocked. */
export function readWipeMarker(): string[] {
  try {
    const raw = localStorage.getItem(WIPE_MARKER_KEY);
    if (raw === null) return [];
    const parsed = markerSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    // Invalid entries are dropped one by one, so they can never name a database.
    const ids = parsed.data.flatMap((entry) => {
      const id = userIdSchema.safeParse(entry);
      return id.success ? [id.data] : [];
    });
    return [...new Set(ids)];
  } catch {
    // Blocked storage or text that is not JSON: both read as an empty marker.
    return [];
  }
}

function writeWipeMarker(ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(WIPE_MARKER_KEY);
    else localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify(ids));
  } catch {
    // Blocked storage: there is no marker to keep, and the wipe still deletes the database.
  }
}

/** An id already present changes nothing; past `MAX_ENTRIES` the oldest is dropped. */
export function addToWipeMarker(userId: string): void {
  if (!USER_ID_PATTERN.test(userId)) return;
  const ids = readWipeMarker();
  if (ids.includes(userId)) return;
  writeWipeMarker([...ids, userId].slice(-MAX_ENTRIES));
}

export function removeFromWipeMarker(userId: string): void {
  if (!USER_ID_PATTERN.test(userId)) return;
  const ids = readWipeMarker();
  if (!ids.includes(userId)) return;
  writeWipeMarker(ids.filter((id) => id !== userId));
}

export function isWipePending(userId: string): boolean {
  return readWipeMarker().includes(userId);
}
